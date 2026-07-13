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
    /function getTikTokInAppDirectAppTarget\(launchConfig\) \{\s+const directAppTarget = String\(\s+launchConfig\?\.direct_ios_url \|\| launchConfig\?\.direct_app_url \|\| "",\s+\)\.trim\(\);/s,
  );
  assert.match(
    templateHtml,
    /const directAppTarget = isInApp \? getTikTokInAppDirectAppTarget\(launchConfig\) : "";\s+if \(tiktokTarget\) \{\s+if \(isInApp && directAppTarget\) \{\s+navigateWindowLocation\(directAppTarget, \{\s*preferTopLevel: true,\s*\}\);\s*\} else if \(isInApp\) \{\s+navigateWindowLocation\(tiktokTarget, \{\s*preferTopLevel: true,\s*\}\);\s*\} else \{\s*openViaAnchor\(\s*tiktokTarget,\s*"_self",\s*"noopener",\s*\);/s,
  );
  assert.match(
    templateHtml,
    /scheduleLaunchFallback\(\s*launchConfig\.direct_web_url \|\| targetUrl,\s*isInApp \? 1500 : 1600,\s*\{ preferTopLevel: isInApp \},\s*\);/s,
  );
});

test("admin article funnel lab routes popup X button through the same launch flow", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(
    templateHtml,
    /function launchOverlayStage\(stageKey, targetUrl, fallbackUrl\)/,
  );
  assert.match(
    templateHtml,
    /const stageKey = closeButton\.dataset\.overlayClose \|\| "";\s+const targetUrl = getEffectiveTarget\(stageKey\);\s+const fallbackUrl = getOverlayLaunchUrl\(stageKey\) \|\| targetUrl;\s+launchOverlayStage\(stageKey, targetUrl, fallbackUrl\);/s,
  );
  assert.match(
    templateHtml,
    /const stageKey = launchButton\.dataset\.overlayLaunch \|\| "";\s+const targetUrl = getEffectiveTarget\(stageKey\);\s+const fallbackUrl =\s+launchButton\.getAttribute\("href"\) \|\|\s+getOverlayLaunchUrl\(stageKey\) \|\|\s+targetUrl;\s+launchOverlayStage\(stageKey, targetUrl, fallbackUrl\);/s,
  );
});

test("admin article funnel lab routes TikTok popup 20s through bridge urls", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(
    templateHtml,
    /function shouldUseOverlayBridgeRoute\(stageKey, targetUrl\) \{/,
  );
  assert.match(
    templateHtml,
    /return \(normalizedStageKey === "20s" \|\| normalizedStageKey === "5s"\) &&\s+detectTargetPlatform\(targetUrl\) === "tiktok";/s,
  );
  assert.match(
    templateHtml,
    /const targetUrl = getEffectiveTarget\(stageKey\);\s+const routePrefix = shouldUseOverlayBridgeRoute\(stageKey, targetUrl\)\s+\? "bridge"\s+:\s+"launch";/s,
  );
  assert.match(
    templateHtml,
    /return `\$\{published\.origin\}\/\$\{slug\}\/\$\{routePrefix\}\/\$\{normalizedStageKey\}`;/,
  );
  assert.match(
    templateHtml,
    /return `\$\{preview\.origin\}\/_lab\/article-funnel-\$\{routePrefix\}\/\$\{slug\}\/\$\{token\}\/\$\{normalizedStageKey\}`;/,
  );
});
