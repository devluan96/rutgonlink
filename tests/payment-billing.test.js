const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20261027_harden_payment_subscriptions.sql",
);
const rejectAwaitingMigrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20261027_allow_reject_awaiting_payments.sql",
);

test("billing plan transitions allow renewals and upgrades but reject downgrades", () => {
  const { __testUtils } = require("../api/index");

  assert.equal(__testUtils.canPurchaseBillingPlan("free", "pro"), true);
  assert.equal(__testUtils.canPurchaseBillingPlan("pro", "pro"), true);
  assert.equal(__testUtils.canPurchaseBillingPlan("pro", "business"), true);
  assert.equal(__testUtils.canPurchaseBillingPlan("business", "pro"), false);
  assert.equal(__testUtils.canPurchaseBillingPlan("admin", "business"), false);
});

test("expired paid plans resolve to free while legacy plans remain active", () => {
  const { __testUtils } = require("../api/index");
  const now = new Date("2026-10-27T00:00:00.000Z");

  assert.equal(
    __testUtils.getEffectiveUserPlan(
      { plan: "pro", plan_expires_at: "2026-10-26T23:59:59.000Z" },
      now,
    ),
    "free",
  );
  assert.equal(
    __testUtils.getEffectiveUserPlan({ plan: "business", plan_expires_at: null }, now),
    "business",
  );
  assert.equal(__testUtils.getEffectiveUserPlan({ plan: "admin" }, now), "admin");
});

test("payment migration makes review and entitlement updates atomic", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(sql, /function public\.review_payment_request/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /status = 'submitted'/i);
  assert.match(sql, /update public\.users/i);
  assert.match(sql, /insert into public\.payment_audit_logs/i);
  assert.match(sql, /revoke execute on function public\.review_payment_request/i);
  assert.match(sql, /grant execute on function public\.review_payment_request/i);
});

test("payment schema prevents duplicate active requests and preserves payment history", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(
    sql,
    /unique[\s\S]*payment_requests[\s\S]*where status in \('awaiting_payment', 'submitted'\)/i,
  );
  assert.match(sql, /check \(amount > 0\)/i);
  assert.match(sql, /check \(status in \('awaiting_payment', 'submitted', 'approved', 'rejected'\)\)/i);
  assert.match(sql, /on delete set null/i);
});

test("billing API uses the atomic review RPC and avoids persistent admin payment cache", () => {
  const dbSource = fs.readFileSync(path.join(__dirname, "..", "api", "db.js"), "utf8");
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );

  assert.match(dbSource, /async reviewPaymentRequest\(/);
  assert.match(dbSource, /\.rpc\('review_payment_request'/);
  assert.doesNotMatch(appSource, /writePersistentStatsCache\(`admin-payments`/);
});

test("production auth and guest cookies are secure and share explicit options", () => {
  const apiSource = fs.readFileSync(path.join(__dirname, "..", "api", "index.js"), "utf8");

  assert.match(apiSource, /const AUTH_COOKIE_OPTIONS =/);
  assert.match(apiSource, /secure:\s*process\.env\.NODE_ENV === "production"/);
  assert.match(apiSource, /res\.cookie\("token", token, \{[\s\S]*\.\.\.AUTH_COOKIE_OPTIONS/);
  assert.match(apiSource, /res\.clearCookie\("token", AUTH_COOKIE_OPTIONS\)/);
});

test("fresh schema includes the payment review RPC and protected payment tables", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "schema.sql"),
    "utf8",
  );

  assert.match(schema, /function public\.review_payment_request/i);
  assert.match(schema, /alter table payment_requests enable row level security/i);
  assert.match(schema, /revoke all on table payment_requests from anon, authenticated/i);
});

test("example environment documents manual payment configuration", () => {
  const exampleEnv = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");

  assert.match(exampleEnv, /PAYMENT_BANK_ID=/);
  assert.match(exampleEnv, /PAYMENT_BANK_ACCOUNT=/);
  assert.match(exampleEnv, /PAYMENT_ACCOUNT_HOLDER=/);
  assert.match(exampleEnv, /PAYMENT_CONTACT=/);
});

test("admins can reject awaiting or submitted payments but only approve submitted payments", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  const cssSource = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.css"),
    "utf8",
  );

  assert.match(appSource, /const canApprove = paymentStatus === "submitted";/);
  assert.match(
    appSource,
    /const canReject = \["awaiting_payment", "submitted"\]\.includes\(paymentStatus\);/,
  );
  assert.match(appSource, /const canReview = status === "approved" \? canApprove : canReject;/);
  assert.match(cssSource, /\.td-actions button:disabled[\s\S]*cursor:\s*not-allowed/);
});

test("follow-up migration records the real previous status when rejecting awaiting payments", () => {
  const sql = fs.readFileSync(rejectAwaitingMigrationPath, "utf8");

  assert.match(
    sql,
    /v_action = 'approved' AND v_request\.status <> 'submitted'/i,
  );
  assert.match(
    sql,
    /v_action = 'rejected'\s+AND v_request\.status NOT IN \('awaiting_payment', 'submitted'\)/i,
  );
  assert.match(sql, /v_previous_status := v_request\.status/i);
  assert.match(sql, /previous_status, next_status/i);
  assert.match(sql, /v_previous_status, v_action/i);
});
