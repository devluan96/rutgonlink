const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("admin article funnel lab prefers launch routes for TikTok popup 20s before inline fallback", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(
    templateHtml,
    /function shouldUseOverlayLaunchRoute\(stageKey, targetUrl, routeLaunchUrl\) \{\s+return \(\s+String\(stageKey \|\| ""\)\.trim\(\) === "20s" &&\s+detectTargetPlatform\(targetUrl\) === "tiktok" &&\s+Boolean\(String\(routeLaunchUrl \|\| ""\)\.trim\(\)\)\s+\);\s+\}/s,
  );
  assert.match(
    templateHtml,
    /const routeLaunchUrl = String\(\s+getOverlayLaunchUrl\(stageKey\) \|\| "",\s+\)\.trim\(\);\s+if \(\s+shouldUseOverlayLaunchRoute\(\s+stageKey,\s+targetUrl,\s+routeLaunchUrl,\s+\)\s+\) \{\s+closeOverlay\(stageKey\);\s+window\.location\.href = routeLaunchUrl;\s+return;\s+\}/s,
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
    /const directAppTarget =\s+isInApp\s+\? getTikTokInAppDirectAppTarget\(launchConfig\)\s+: "";/s,
  );
});

test("admin article funnel lab supports saved popup 3s opaanlp overrides and share preview uploads", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(templateHtml, /id="popup3sIosFbInput"/);
  assert.match(templateHtml, /data-asset-upload-trigger="shareImage"/);
  assert.match(templateHtml, /data-asset-upload-input="shareImage"/);
  assert.match(
    templateHtml,
    /<label for="descriptionInput">[\s\S]*?<label for="shareImageInput">/s,
  );
  assert.doesNotMatch(templateHtml, /applyValue\("shareImage"\)/);
  assert.match(
    templateHtml,
    /popup3sIosFbUrl:\s*String\(\s*source\.popup3sIosFbUrl \|\|/s,
  );
  assert.match(
    templateHtml,
    /popup_3s_ios_fb_url:\s*state\.popup3sIosFbUrl\.trim\(\)/,
  );
  assert.match(
    templateHtml,
    /normalizedStageKey === "3s"\s+&&\s+String\(launchConfig\.direct_platform \|\| ""\)\.trim\(\) === "shopee"/s,
  );
  assert.match(templateHtml, /direct_ios_fb_url:\s*iosInAppOverride/);
});

test("admin article funnel lab keeps Shopee popup 3s web-first on iPhone in-app", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(
    templateHtml,
    /function buildShopeeIosInAppWebUrl\(targetUrl\) \{/,
  );
  assert.match(
    templateHtml,
    /const shopeeIosFbUrl =\s+platform === "shopee"\s+\? buildShopeeIosInAppWebUrl\(targetUrl\) \|\| targetUrl\s+: targetUrl;/s,
  );
  assert.match(
    templateHtml,
    /const shouldForceShopeeWebFirst =\s+isInApp &&\s+String\(launchConfig\.stage_key \|\| ""\)\.trim\(\) === "3s";/s,
  );
  assert.match(
    templateHtml,
    /const shopeeInAppWebTarget =\s+launchConfig\.direct_ios_browser_url \|\|\s+launchConfig\.direct_web_url \|\|\s+launchConfig\.target_url \|\|\s+"";/s,
  );
  assert.match(
    templateHtml,
    /const shopeeDirectAppTarget =\s+!shouldForceShopeeWebFirst && isInApp\s+\? String\(\s+launchConfig\.direct_ios_url \|\|\s+launchConfig\.direct_app_url \|\|\s+"",\s+\)\.trim\(\)\s+: "";/s,
  );
  assert.match(
    templateHtml,
    /const iosTarget = shouldForceShopeeWebFirst\s+\? isFacebook\s+\? launchConfig\.direct_ios_fb_url \|\|\s+shopeeInAppWebTarget \|\|\s+launchConfig\.direct_ios_url\s+: shopeeInAppWebTarget \|\|\s+launchConfig\.direct_ios_fb_url \|\|\s+launchConfig\.direct_ios_url\s+: isInApp/s,
  );
  assert.match(
    templateHtml,
    /if \(isInApp\) \{\s+navigateWindowLocation\(iosTarget, \{\s+preferTopLevel: true,\s+\}\);/s,
  );
  assert.match(
    templateHtml,
    /scheduleLaunchFallback\(\s+launchConfig\.direct_web_url \|\| targetUrl,\s+isInApp \? 1500 : 1600,\s+\{ preferTopLevel: isInApp \},\s+\);/s,
  );
  assert.match(
    templateHtml,
    /let blurTimer = null;/,
  );
  assert.match(
    templateHtml,
    /const onBlur = \(\) => \{\s+clearBlurTimer\(\);\s+blurTimer = setTimeout\(\(\) => \{\s+blurTimer = null;\s+if \(document\.hidden \|\| !document\.hasFocus\(\)\) \{\s+markLeft\(\);/s,
  );
  assert.match(
    templateHtml,
    /window\.addEventListener\("blur", onBlur, true\);/,
  );
  assert.match(
    templateHtml,
    /window\.addEventListener\("focus", onFocus, true\);/,
  );
});

test("admin article funnel lab can copy the derived TikTok app deeplink from popup 20s links", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(
    templateHtml,
    /data-copy-derived-deeplink="popup20sInput"/,
  );
  assert.match(
    templateHtml,
    /async function copyDerivedTikTokDeepLink\(fieldKey\) \{/,
  );
  assert.match(
    templateHtml,
    /const deeplink = String\(\s+launchConfig\?\.direct_ios_url \|\|\s+launchConfig\?\.direct_app_url \|\|\s+"",\s+\)\.trim\(\);/s,
  );
  assert.match(
    templateHtml,
    /await navigator\.clipboard\.writeText\(deeplink\);/,
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

test("admin article funnel lab keeps TikTok popup 20s on launch helpers instead of bridge urls", () => {
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
    /return false;/,
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

test("admin article funnel lab uploads sensitive video blocks through the video flow", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "api", "templates", "admin-article-funnel-lab.html"),
    "utf8",
  );

  assert.match(templateHtml, /async function fetchLabVideoUploadSignature\(file\) \{/);
  assert.match(templateHtml, /\/api\/upload-video\/signature/);
  assert.match(
    templateHtml,
    /if \(isVideo\) \{\s+try \{\s+return await uploadVideoBlockDirect\(file\);/s,
  );

  assert.match(
    templateHtml,
    /function isVideoBlockType\(blockType\) \{\s+return blockType === "video" \|\| blockType === "sensitive-video";\s+\}/s,
  );
  assert.match(
    templateHtml,
    /async function uploadBlockAsset\(file, blockType\) \{\s+const isVideo = isVideoBlockType\(blockType\);/s,
  );
  assert.match(
    templateHtml,
    /setUploadStatus\(\s+blockId,\s+isVideoBlockType\(block\.type\)\s+\? "Đang upload video\.\.\."\s+: "Đang upload ảnh\.\.\.",\s+\);/s,
  );
  assert.match(
    templateHtml,
    /showToast\(\s+isVideoBlockType\(block\.type\) \? "Đã tải video lên" : "Đã tải ảnh lên",\s+\);/s,
  );
});
