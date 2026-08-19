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
const indexSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "index.html"),
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

test("notification bell UI and active polling are removed", () => {
  assert.doesNotMatch(indexSource, /id="notificationBellBtn"/);
  assert.doesNotMatch(indexSource, /id="notificationDropdown"/);
  assert.doesNotMatch(appSource, /startRealtimeNotificationLoop\(/);
  assert.doesNotMatch(appSource, /stopRealtimeNotificationLoop\(/);
});

test("admin overview avoids unbounded click and link reads", () => {
  assert.match(
    apiSource,
    /ADMIN_STATS_RESPONSE_CACHE_TTL_MS = Math\.max\([\s\S]{0,120}?\|\| 120000,/s,
  );
  assert.match(
    dbSource,
    /async getAdminTotals\(options = \{\}[\s\S]{0,900}?includeClickTotal = options\?\.includeClickTotal !== false/s,
  );
  assert.match(
    dbSource,
    /async getAdminTopLinks\(limit = 5\)[\s\S]{0,500}?\.limit\(safeLimit\)/s,
  );
  assert.match(
    apiSource,
    /database\.getAdminTotals\(\{ includeClickTotal: false \}\)/,
  );
  assert.match(apiSource, /database\.getAdminTopLinks\(5\)/);
  assert.match(
    apiSource,
    /getAdminArticleFunnelClickAnalyticsRows\(\{[\s\S]{0,120}?limit: 1000,[\s\S]{0,80}?days: 30,/s,
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
  assert.doesNotMatch(
    appSource,
    /async function pollRealtimeNotifications\(\) \{[\s\S]{0,2200}?await loadDashboardData\(/s,
  );
  assert.doesNotMatch(
    appSource,
    /async function pollRealtimeNotifications\(\) \{[\s\S]{0,2200}?await loadData\(/s,
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

test("stats routes use soft timeouts for slow analytics queries on live data", () => {
  assert.match(
    apiSource,
    /const STATS_QUERY_TIMEOUT_MS = Math\.max\(\s*Number\(process\.env\.STATS_QUERY_TIMEOUT_MS\) \|\| 4000,\s*1000,\s*\);/s,
  );
  assert.match(
    apiSource,
    /async function measureAsyncTimingWithSoftTimeout\(/,
  );
  assert.match(
    apiSource,
    /measureAsyncTimingWithSoftTimeout\(\s*"analyticsSummaryRpc"/,
  );
  assert.match(
    apiSource,
    /measureAsyncTimingWithSoftTimeout\(\s*"analyticsYesterdaySummaryRpc"/,
  );
  assert.match(
    apiSource,
    /measureAsyncTimingWithSoftTimeout\(\s*"labAnalyticsRows"/,
  );
  assert.match(
    apiSource,
    /measureAsyncTimingWithSoftTimeout\(\s*"labAnalyticsYesterdayRows"/,
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
    /async function loadBillingData\(force = false\) \{/,
  );
  assert.match(
    appSource,
    /!force &&[\s\S]{0,240}?BILLING_DATA_CACHE_TTL_MS/s,
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
    /if \(pageNeedsFullStatsPayload\(page\)\) \{\s*void loadData\(null,\s*\{\s*preferCache:\s*true\s*\}\);\s*\}/,
  );
});

test("dashboard, stats, and links pages reuse browser cache until a manual reload", () => {
  assert.match(
    appSource,
    /void loadDashboardData\(\{\s*preferCache:\s*true\s*\}\);/,
  );
  assert.match(
    appSource,
    /void loadLinksData\(\{\s*preferCache:\s*true\s*\}\);/,
  );
  assert.match(
    appSource,
    /void loadData\(null,\s*\{\s*preferCache:\s*true\s*\}\);/,
  );
  assert.match(
    appSource,
    /function reloadDashboardPageData\(\) \{/,
  );
  assert.match(
    appSource,
    /function reloadStatsPageData\(\) \{/,
  );
  assert.match(
    appSource,
    /function reloadLinksPageData\(\) \{/,
  );
  assert.match(
    appSource,
    /const d =\s+prefetched\s+\|\|\s+\(await getStatsPayload\(\{\s*preferCache: options\.preferCache !== false,\s*forceNetwork: !!options\.forceNetwork,/s,
  );
});

test("manual reload bypasses both memory and persistent browser caches", () => {
  assert.match(
    appSource,
    /if \(\s*preferCache &&\s*!forceNetwork &&\s*statsPayloadCache &&/s,
  );
  assert.match(
    appSource,
    /if \(options\.preferCache !== false && !options\.forceNetwork\) \{/,
  );
  assert.match(
    appSource,
    /function loadAvailableDomains\(\{ force = false \} = \{\}\)/,
  );
  assert.match(appSource, /DOMAINS_CACHE_TTL_MS = 5 \* 60 \* 1000/);
});

test("remaining data tabs use bounded session caches and real force reloads", () => {
  assert.match(appSource, /PERSISTED_STATS_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(
    appSource,
    /Date\.now\(\) - Number\(parsed\.cachedAt\) > maxAgeMs/,
  );
  assert.match(
    appSource,
    /async function loadTeamWorkspace\(\{ silent = false, force = false \}/,
  );
  assert.match(
    appSource,
    /async function loadBillingData\(force = false\)/,
  );
  assert.match(indexSource, /onclick="loadAdminData\(true\)"/);
  assert.match(
    appSource,
    /readPersistentStatsCache\("team-workspace"\)/,
  );
  assert.match(
    appSource,
    /writePersistentStatsCache\("team-workspace", teamWorkspaceData\)/,
  );
  assert.match(
    appSource,
    /function hydrateAdminSectionFromPersistentCache\(section\)/,
  );
  assert.match(
    appSource,
    /readPersistentStatsCache\(`admin-\$\{section\}`,\s*\{\s*ttlMs: ADMIN_SECTION_CACHE_TTL_MS,?\s*\}\)/,
  );
  assert.match(
    appSource,
    /writePersistentStatsCache\(`admin-(overview|system|users|logs|payments)`/,
  );
});
