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
  assert.doesNotMatch(appJs, /labSharedShareImageInput/);
  assert.match(appJs, /async function adminSetLabAccess\(userId, checkboxEl\)/);
});

test("db user fallback preserves can_use_lab when only other optional columns are missing", () => {
  const dbJs = fs.readFileSync(
    path.join(__dirname, "..", "api", "db.js"),
    "utf8",
  );

  assert.match(dbJs, /const activeOptionalColumns = \['phone', 'avatar_url', 'can_use_lab', 'updated_at'\];/);
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
    /app\.get\("\/api\/admin\/article-funnel-labs", requireArticleFunnelLab, async \(req, res\) => \{[\s\S]*?createdByUserId:\s*req\.currentUser\?\.id \|\| 0,/,
  );
  assert.doesNotMatch(
    indexJs,
    /app\.get\("\/api\/admin\/article-funnel-labs", requireArticleFunnelLab, async \(req, res\) => \{[\s\S]*?createdByUserId:\s*isAdminUserRecord\(req\.currentUser\)/,
  );
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
    /lab_shared_settings:\s*normalizeUserLabSharedSettings\(\s*user\.lab_shared_settings_json \|\| \{\},/s,
  );
  assert.match(appJs, /function syncLabSharedSettingsStorageFromUser\(\)/);
  assert.match(
    appJs,
    /body:\s*JSON\.stringify\(\{\s*lab_shared_settings:\s*nextSettings\s*\}\)/s,
  );
});
