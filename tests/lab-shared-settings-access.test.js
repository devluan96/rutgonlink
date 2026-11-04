const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("lab shared settings modal exposes saved 3s and opaanlp defaults", () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"),
    "utf8",
  );

  assert.match(indexHtml, /id="labSharedPopup3UrlInput"/);
  assert.match(indexHtml, /id="labSharedPopup3IosFbUrlInput"/);
  assert.doesNotMatch(indexHtml, /id="labSharedShareImageInput"/);
  assert.match(indexHtml, />Lab<\/th>/);
});

test("app lab access logic allows explicitly granted users and stores popup 3s defaults", () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );

  assert.match(
    appJs,
    /function canUseLabTabs\(\) \{\s+return isAdminUser\(\) \|\| !!user\?\.can_use_lab;\s+\}/s,
  );
  assert.match(appJs, /popup3sUrl:\s*String\(source\.popup3sUrl \|\| ""\)\.trim\(\)/);
  assert.match(
    appJs,
    /popup3sIosFbUrl:\s*String\(source\.popup3sIosFbUrl \|\| ""\)\.trim\(\)/,
  );
  assert.match(
    appJs,
    /function getAffiliateShopeeSourceProductUrl\(source = null\) \{[\s\S]{0,160}?source\?\.product_url \|\| source\?\.productUrl \|\| source\?\.url \|\| ""[\s\S]{0,40}?\.trim\(\);[\s\S]{0,10}?\}/,
  );
  assert.match(
    appJs,
    /data-affiliate-shopee-source-product-url/,
  );
  assert.doesNotMatch(appJs, /labSharedShareImageInput/);
  assert.match(appJs, /async function adminSetLabAccess\(userId, checkboxEl\)/);
});

test("db user fallback preserves can_use_lab when only other optional columns are missing", () => {
  const dbJs = fs.readFileSync(
    path.join(__dirname, "..", "api", "db.js"),
    "utf8",
  );

  assert.match(
    dbJs,
    /const activeOptionalColumns = \[[\s\S]{0,180}?'phone',[\s\S]{0,80}?'avatar_url',[\s\S]{0,80}?'can_use_lab',[\s\S]{0,120}?'updated_at',[\s\S]{0,20}?\];/,
  );
  assert.match(dbJs, /const missingColumn = activeOptionalColumns\.find\(\(columnName\) =>\s+isMissingColumnError\(error, columnName\),\s+\);/s);
  assert.match(dbJs, /return Array\.isArray\(data\)\s+\? data\.map\(\(row\) => normalizeLegacyAdminUserRow\(row\)\)\s+: \[\];/s);
  assert.doesNotMatch(dbJs, /can_use_lab:\s*false/);
});

test("article funnel lab list scopes admins to their own labs", () => {
  const indexJs = fs.readFileSync(
    path.join(__dirname, "..", "api", "index.js"),
    "utf8",
  );

  assert.match(
    indexJs,
    /app\.get\(\s*"\/api\/admin\/article-funnel-labs",\s*requireArticleFunnelLab,\s*async \(req, res\) => \{[\s\S]*?createdByUserId:\s*req\.currentUser\?\.id \|\| 0,/,
  );
  assert.doesNotMatch(
    indexJs,
    /app\.get\(\s*"\/api\/admin\/article-funnel-labs",\s*requireArticleFunnelLab,\s*async \(req, res\) => \{[\s\S]*?createdByUserId:\s*isAdminUserRecord\(req\.currentUser\)/,
  );
});

test("opening an existing lab keeps edit intent until the detail request settles", () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(appJs, /async function openExistingLabInCreateEditor\(labId\)/);
  assert.match(
    appJs,
    /async function openExistingLabInCreateEditor\(labId\)[\s\S]{0,1800}?await refreshLabEmbed\("createLabIframe"\)/,
  );
  assert.match(templateHtml, /let pendingLabLoadId = 0;/);
  assert.match(templateHtml, /dataset\.labLoadDisabled/);
  assert.match(
    templateHtml,
    /if \(\s*pendingLabLoadId <= 0 &&\s*selectedLabId > 0 &&[\s\S]{0,240}?!labItems\.some\([\s\S]{0,180}?selectedLabId[\s\S]{0,100}?selectedLabId = 0;/,
  );
  assert.doesNotMatch(
    templateHtml,
    /catch \(error\) \{[\s\S]{0,500}?createDbLab\(\);[\s\S]{0,300}?Kh[^\n]*t[^\n]*i[^\n]*lab n[^\n]*y/,
  );
});

test("article funnel lab APIs normalize legacy string config_json payloads", () => {
  const indexJs = fs.readFileSync(
    path.join(__dirname, "..", "api", "index.js"),
    "utf8",
  );
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(indexJs, /function normalizeArticleFunnelLabConfigJson\(rawConfig\)/);
  assert.match(
    indexJs,
    /const configJson = normalizeArticleFunnelLabConfigJson\(\s*item\.config_json,?\s*\);/,
  );
  assert.match(
    indexJs,
    /const configJson = normalizeArticleFunnelLabConfigJson\(row\.config_json\);/,
  );
  assert.match(templateHtml, /function parseLabConfigPayload\(input\)/);
  assert.match(
    templateHtml,
    /normalizeImportedState\(\s*parseLabConfigPayload\(item\.config_json\),\s*\)/s,
  );
});

test("article funnel lab APIs reuse the published funnel domain for lab list and detail links", () => {
  const indexJs = fs.readFileSync(
    path.join(__dirname, "..", "api", "index.js"),
    "utf8",
  );

  assert.match(
    indexJs,
    /const publishedArticleFunnel = item\.published_route_slug\s+\? await database\.getArticleFunnelBySlug\(item\.published_route_slug\)\s+:\s+null;/s,
  );
  assert.match(
    indexJs,
    /const publishedDomainHostname =\s+normalizeDomainHost\(publishedArticleFunnel\?\.domain_hostname\) \|\|\s+normalizeDomainHost\(configJson\.source_domain\);/s,
  );
  assert.match(indexJs, /domain_hostname:\s*publishedDomainHostname \|\| "",/);
});

test("lab shared settings persist on the user profile instead of local-only storage", () => {
  const schemaSql = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "schema.sql"),
    "utf8",
  );
  const dbJs = fs.readFileSync(
    path.join(__dirname, "..", "api", "db.js"),
    "utf8",
  );
  const indexJs = fs.readFileSync(
    path.join(__dirname, "..", "api", "index.js"),
    "utf8",
  );
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );

  assert.match(
    schemaSql,
    /lab_shared_settings_json JSONB NOT NULL DEFAULT '\{\}'::jsonb/,
  );
  assert.match(
    dbJs,
    /Object\.prototype\.hasOwnProperty\.call\(profile, 'lab_shared_settings_json'\)/,
  );
  assert.match(
    indexJs,
    /const settingsBundle = normalizeUserSettingsBundle\(\s*user\.lab_shared_settings_json \|\| \{\},/s,
  );
  assert.match(appJs, /function syncLabSharedSettingsStorageFromUser\(\)/);
  assert.match(
    appJs,
    /body:\s*JSON\.stringify\(\{\s*lab_shared_settings:\s*nextSettings\s*\}\)/s,
  );
});
