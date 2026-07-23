const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dbSource = fs.readFileSync(
  path.join(__dirname, "..", "api", "db.js"),
  "utf8",
);
const apiSource = fs.readFileSync(
  path.join(__dirname, "..", "api", "index.js"),
  "utf8",
);
const appSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "app.js"),
  "utf8",
);

test("article funnel click row query no longer duplicates config_json on every row", () => {
  assert.match(
    dbSource,
    /const selectExpr = includeAll\s*\?\s*'article_funnel_id,route_slug,stage_key,ip,user_agent,referrer,country_code,country_name,city,clicked_at'/,
  );
  assert.doesNotMatch(
    dbSource,
    /article_funnels!inner\(created_by_user_id,config_json\)|article_funnels\(config_json\)/,
  );
  assert.match(
    dbSource,
    /\.from\('article_funnels'\)\s*\.select\('id,config_json'\)\s*\.in\('id', articleFunnelIds\)/,
  );
});

test("admin notification summary route exists for lightweight polling", () => {
  assert.match(
    apiSource,
    /app\.get\("\/api\/admin\/notification-summary", requireAdmin, async \(req, res\) => \{/,
  );
  assert.match(
    apiSource,
    /readRecentRedirectLogEntries\(3\)/,
  );
  assert.match(
    apiSource,
    /database\.countUsers\(\)/,
  );
});

test("user stats summary route exists for lightweight notification polling", () => {
  assert.match(
    apiSource,
    /app\.get\("\/api\/stats\/summary", async \(req, res\) => \{/,
  );
  assert.match(
    apiSource,
    /database\.getLatestLink\(userId,\s*guestSessionId,\s*\{[\s\S]{0,40}?select:\s*"stats"[\s\S]{0,20}?\}\s*\)/,
  );
  assert.match(
    apiSource,
    /database\.getArticleFunnelClickStats\(userId, \{/,
  );
  assert.doesNotMatch(
    apiSource,
    /app\.get\("\/api\/stats\/summary"[\s\S]{0,4000}?database\.getRecentLinks\(userId, guestSessionId\)/s,
  );
  assert.match(
    apiSource,
    /getClickAnalyticsSummary\(\s*userId,\s*guestSessionId,\s*\{[\s\S]{0,80}?days:\s*1,/,
  );
  assert.match(
    apiSource,
    /database\.countLinks\(userId, guestSessionId\)/,
  );
  assert.doesNotMatch(
    apiSource,
    /app\.get\("\/api\/stats\/summary"[\s\S]{0,2200}?database\.getTotals\(userId, guestSessionId\)/s,
  );
});

test("frontend notification polling uses lightweight admin summary endpoint", () => {
  assert.match(
    appSource,
    /fetch\(\s*"\/api\/admin\/notification-summary"/,
  );
  assert.doesNotMatch(
    appSource,
    /const \[adminStatsResponse, redirectResponse\] = await Promise\.all\(\[\s*fetch\("\/api\/admin\/stats"\),\s*fetch\("\/api\/admin\/redirects\?limit=3"\),/s,
  );
  assert.match(
    appSource,
    /const SUPPORT_POLL_INTERVAL_MS = 20000;/,
  );
});

test("frontend notification polling uses lightweight user stats summary endpoint", () => {
  assert.match(
    appSource,
    /const statsPayload = await getStatsSummaryPayload\(\{ preferCache: true \}\);/,
  );
  assert.match(
    appSource,
    /const response = await fetch\("\/api\/stats\/summary"\);/,
  );
  assert.match(
    appSource,
    /function pageNeedsFullStatsPayload\(page = getActiveAppPage\(\)\) \{/,
  );
  assert.doesNotMatch(
    appSource,
    /async function pollRealtimeNotifications\(\) \{[\s\S]{0,1200}?getStatsPayload\(\{ preferCache: true \}\)/s,
  );
});

test("full stats route supports explicit day ranges and frontend requests them on demand", () => {
  assert.match(
    apiSource,
    /const statsRangeDays = normalizeStatsRangeDays\(req\.query\.days, 1\);/,
  );
  assert.match(
    apiSource,
    /const cacheKey = `\$\{buildStatsCacheKey\(userId, guestSessionId\)\}:days:\$\{statsRangeDays\}`;/,
  );
  assert.match(
    appSource,
    /function setStatsRangeDays\(value\) \{/,
  );
  assert.match(
    appSource,
    /fetch\(`\/api\/stats\?days=\$\{requestedDays\}`\)/,
  );
  assert.match(
    apiSource,
    /database\.getRecentLinks\(userId, guestSessionId, \{\s*limit: STATS_RECENT_LINK_LIMIT,\s*select: "stats",\s*\}\)/s,
  );
});

test("bio profile sync is lazy-loaded instead of preloading on app boot", () => {
  assert.match(
    appSource,
    /async function syncBioProfileFromServer\(\{ force = false \} = \{\}\)/,
  );
  assert.match(
    appSource,
    /if \(!force && bioProfileSyncedUserId === activeUserId\)/,
  );
  assert.match(
    appSource,
    /function renderBioPage\(\) \{\s*const cfg = loadBioConfig\(\);\s*if \(user\?\.id\) \{\s*void syncBioProfileFromServer\(\);\s*\}/s,
  );
  assert.doesNotMatch(
    appSource,
    /function showApp\(\) \{[\s\S]{0,500}?syncBioProfileFromServer\(\)/s,
  );
  assert.doesNotMatch(
    appSource,
    /async function showApp\(\) \{[\s\S]{0,500}?syncBioProfileFromServer\(\)/s,
  );
});

test("billing config is lazy-loaded instead of preloading on app boot", () => {
  assert.match(
    appSource,
    /async function loadBillingData\(\) \{/,
  );
  assert.match(
    appSource,
    /if \(billingDataLoadedUserId === activeUserId && !billingDataPromise\) \{/,
  );
  assert.match(
    appSource,
    /function renderAccountPage\(\) \{[\s\S]{0,1200}?void loadBillingData\(\);/s,
  );
  assert.match(
    appSource,
    /function renderPaymentPage\(\) \{[\s\S]{0,800}?void loadBillingData\(\);/s,
  );
  assert.doesNotMatch(
    appSource,
    /async function showApp\(\) \{[\s\S]{0,400}?loadBillingData\(\)/s,
  );
});

test("full stats payload is no longer preloaded for every app page on boot", () => {
  assert.doesNotMatch(
    appSource,
    /async function showApp\(\) \{[\s\S]{0,400}?loadData\(\)/s,
  );
  assert.doesNotMatch(
    appSource,
    /function continueAsGuest\(\) \{[\s\S]{0,400}?loadData\(\)/s,
  );
  assert.match(
    appSource,
    /if \(pageNeedsFullStatsPayload\(page\)\) \{\s*void loadData\(\);\s*\}/,
  );
});
