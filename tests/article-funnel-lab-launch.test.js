const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("admin article funnel lab uses top-level navigation for TikTok iOS in-app popup launch", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(
    templateHtml,
    /function navigateWindowLocation\(targetUrl, options = \{\}\)/,
  );
  assert.match(
    templateHtml,
    /if \(isInApp\) \{\s*navigateWindowLocation\(tiktokTarget, \{\s*preferTopLevel: true,\s*\}\);\s*\} else \{\s*openViaAnchor\(\s*tiktokTarget,\s*"_self",\s*"noopener",\s*\);/s,
  );
  assert.match(
    templateHtml,
    /scheduleLaunchFallback\(\s*launchConfig\.direct_web_url \|\| targetUrl,\s*isInApp \? 1500 : 1600,\s*\{ preferTopLevel: isInApp \},\s*\);/s,
  );
});
