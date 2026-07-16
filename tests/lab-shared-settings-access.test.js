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
