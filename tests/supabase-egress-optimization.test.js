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
