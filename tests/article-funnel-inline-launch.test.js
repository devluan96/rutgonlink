const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("shouldUseArticleFunnelInlineLaunch keeps Shopee 3s and TikTok 20s on inline launch", () => {
  assert.equal(
    __testUtils.shouldUseArticleFunnelInlineLaunch({
      stage_key: "3s",
      direct_platform: "shopee",
    }),
    true,
  );
  assert.equal(
    __testUtils.shouldUseArticleFunnelInlineLaunch({
      stage_key: "20s",
      direct_platform: "tiktok",
    }),
    true,
  );
  assert.equal(
    __testUtils.shouldUseArticleFunnelInlineLaunch({
      stage_key: "20s",
      direct_platform: "shopee",
    }),
    false,
  );
  assert.equal(
    __testUtils.shouldUseArticleFunnelInlineLaunch({
      stage_key: "3s",
      direct_platform: "tiktok",
    }),
    false,
  );
});

test("buildArticleFunnelPreviewPage keeps Shopee popup 3s web-first on iPhone in-app", () => {
  const html = __testUtils.buildArticleFunnelPreviewPage(
    {
      title: "Demo",
      stages: [
        {
          stage_key: "3s",
          direct_platform: "shopee",
          direct_web_url: "https://shopee.vn/product/37251933/591989399",
        },
      ],
    },
    "https://example.com/demo",
    "/demo/launch",
    { routeSlug: "demo", showPopupTestButton: true },
    "/demo/bridge",
  );

  assert.match(html, /"use_inline_launch":true/);
  assert.match(html, /\/api\/article-funnel\/track-click/);
  assert.match(html, /"demo"/);
  assert.match(html, /id="popupTest20sBtn"/);
  assert.match(html, /Mở popup 20s/);
  assert.match(html, /var canShowPopupTestButton = true;/);
  assert.match(
    html,
    /function isFacebookInAppBrowser\(\) \{\s+return \/FBAN\|FBAV\|FB_IAB\|FBIOS\|FB4A\/i\.test\(getUserAgent\(\)\);\s+\}/s,
  );
  assert.match(
    html,
    /function getNativePopupDirectAppLaunchUrl\(stage\) \{\s+if \(!stage\) return '';\s+var launchCandidates = \[\s+stage\.direct_ios_url,\s+stage\.direct_app_url,\s+\];/s,
  );
  assert.match(html, /function navigateWindowLocation\(targetUrl, options\) \{/);
  assert.match(
    html,
    /var shouldForceShopeeWebFirst =\s+isInApp && String\(stage\.stage_key \|\| ''\) === '3s';/s,
  );
  assert.match(
    html,
    /var shopeeInAppWebTarget =\s+stage\.direct_ios_browser_url \|\|\s+stage\.direct_web_url \|\|\s+stage\.target_url \|\|\s+'';/s,
  );
  assert.match(
    html,
    /var shopeeDirectAppTarget = !shouldForceShopeeWebFirst && isInApp\s+\? getNativePopupDirectAppLaunchUrl\(stage\)\s+: '';/s,
  );
  assert.match(
    html,
    /var iosTarget = shouldForceShopeeWebFirst\s+\? \(\s+isFacebookInApp\s+\? \(stage\.direct_ios_fb_url \|\| shopeeInAppWebTarget \|\| stage\.direct_ios_url\)\s+:\s+\(shopeeInAppWebTarget \|\| stage\.direct_ios_fb_url \|\| stage\.direct_ios_url\)\s+\)\s+: isInApp/s,
  );
  assert.match(html, /function scheduleLaunchFallback\(fallbackUrl, delayMs, options\)/);
  assert.match(html, /window\.addEventListener\('pagehide', markLeft, true\)/);
  assert.match(html, /var blurTimer = null;/);
  assert.match(
    html,
    /function onBlur\(\) \{\s+clearBlurTimer\(\);\s+blurTimer = setTimeout\(function\(\) \{\s+blurTimer = null;\s+if \(document\.hidden \|\| !document\.hasFocus\(\)\) \{\s+markLeft\(\);/s,
  );
  assert.match(html, /window\.addEventListener\('blur', onBlur, true\)/);
  assert.match(html, /window\.addEventListener\('focus', onFocus, true\)/);
  assert.match(
    html,
    /var shouldSuppressShopeeInAppFallback =\s+shouldForceShopeeWebFirst && isInApp;/s,
  );
  assert.match(
    html,
    /if \(!shouldSuppressShopeeInAppFallback\) \{\s+scheduleLaunchFallback\(\s+stage\.direct_web_url,\s+isInApp \? 1500 : 1600,\s+\{ preferTopLevel: isInApp \},\s+\);\s+\}/s,
  );
});

test("buildArticleFunnelPreviewPage emits a parseable inline script", () => {
  const html = __testUtils.buildArticleFunnelPreviewPage(
    {
      title: "Demo",
      stages: [
        {
          stage_key: "3s",
          direct_platform: "shopee",
          direct_web_url: "https://shopee.vn/product/37251933/591989399",
        },
        {
          stage_key: "20s",
          direct_platform: "tiktok",
          direct_web_url: "https://vt.tiktok.com/demo/",
          direct_ios_url:
            "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%22123%22%5D%7D",
        },
      ],
    },
    "https://example.com/demo",
    "/demo/launch",
    { routeSlug: "demo", showPopupTestButton: true },
    "/demo/bridge",
  );

  const scriptMatch = html.match(/<script>\s*\(function\(\)\{([\s\S]*?)\}\)\(\);\s*<\/script>/);
  assert.ok(scriptMatch, "expected inline preview script");
  assert.doesNotThrow(() => {
    new Function(scriptMatch[1]);
  });
});

test("buildArticleFunnelPreviewPage renders video-embed blocks as iframe instead of image", () => {
  const html = __testUtils.buildArticleFunnelPreviewPage(
    {
      title: "Demo embed",
      blocks: [
        {
          type: "video-embed",
          src: "https://player.vimeo.com/video/1214443665?dnt=1&app_id=122963",
          caption: "Vimeo embed",
        },
      ],
    },
    "https://example.com/demo-embed",
    "/demo-embed/launch",
    { routeSlug: "demo-embed" },
    "/demo-embed/bridge",
  );

  assert.match(html, /\.article-media iframe\{/);
  assert.match(
    html,
    /if \(block\.type === 'video-embed'\)/,
  );
  assert.match(
    html,
    /allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"/,
  );
  assert.doesNotMatch(
    html,
    /<figure class="article-media"><img src="\'+escHtml\(block\.src\|\|''\)\+'" alt=""><\/figure>/,
  );
});

test("buildArticleFunnelPreviewPage keeps popup test button hidden for non-admin viewers", () => {
  const html = __testUtils.buildArticleFunnelPreviewPage(
    {
      title: "Demo",
      stages: [
        {
          stage_key: "20s",
          direct_platform: "tiktok",
          direct_web_url: "https://vt.tiktok.com/demo/",
        },
      ],
    },
    "https://example.com/demo",
    "/demo/launch",
    { routeSlug: "demo" },
    "/demo/bridge",
  );

  assert.match(html, /var canShowPopupTestButton = false;/);
  assert.match(
    html,
    /popupTest20sBtn\.hidden = !canShowPopupTestButton \|\| !getStageByKey\('20s'\)/,
  );
});

test("buildArticleFunnelPreviewPage routes TikTok 20s through the launch helper like regular deeplinks", () => {
  const html = __testUtils.buildArticleFunnelPreviewPage(
    {
      title: "Demo",
      stages: [
        {
          stage_key: "20s",
          direct_platform: "tiktok",
          direct_web_url: "https://vt.tiktok.com/demo/",
        },
      ],
    },
    "https://example.com/demo",
    "/demo/launch",
    { routeSlug: "demo", showPopupTestButton: true },
    "/demo/bridge",
    "/demo/go",
  );

  assert.match(
    html,
    /"stage_key":"20s","direct_platform":"tiktok","direct_web_url":"https:\/\/vt\.tiktok\.com\/demo\/","use_inline_launch":true,"use_deeplink_route":false/,
  );
  assert.match(html, /var bridgeBasePath = "\/demo\/bridge"/);
  assert.match(html, /var deeplinkBasePath = "\/demo\/go"/);
  assert.match(
    html,
    /function shouldEnablePopupDebugMode\(\) \{\s+try \{\s+var params = new URLSearchParams\(window\.location\.search \|\| ''\);\s+return params\.get\('popup_debug'\) === '1' \|\|\s+\(Boolean\(params\.get\('popup_test'\)\) && Boolean\(params\.get\('popup_test_token'\)\)\);/s,
  );
  assert.match(
    html,
    /function appendPopupDebugQuery\(rawUrl\) \{[\s\S]*?parsed\.searchParams\.set\('popup_debug', '1'\);[\s\S]*?\}/s,
  );
  assert.match(html, /function shouldUseDedicatedBridgeRoute\(stage\) \{\s+return false;\s+\}/);
  assert.match(
    html,
    /function getStageOpenUrl\(stage\) \{\s+return shouldUseDedicatedBridgeRoute\(stage\)\s+\? \(getBridgeUrl\(stage\) \|\| getLaunchUrl\(stage\)\)\s+:\s+getLaunchUrl\(stage\);\s+\}/s,
  );
  assert.match(
    html,
    /function getLaunchUrl\(stage\)\{\s+var stageKey = encodeURIComponent\(String\(stage && stage\.stage_key \|\| ''\)\);\s+var basePath =\s+stage && stage\.use_deeplink_route\s+\? \(deeplinkBasePath \|\| launchBasePath \|\| location\.pathname\)\s+:\s+\(launchBasePath \|\| location\.pathname\);\s+return appendSnapshotQuery\(\s*appendPopupDebugQuery\(basePath \+ '\/' \+ stageKey\)\s*\);\s+\}/s,
  );
  assert.match(
    html,
    /function getNativeAnchorHref\(stage\) \{\s+if \(!stage\) return '';\s+if \(stage\.use_inline_launch\) \{[\s\S]*?\}\s+return getStageOpenUrl\(stage\) \|\| stage\.direct_web_url \|\| '#';\s+\}/s,
  );
  assert.match(
    html,
    /var launchUrl = fallbackUrl \|\| getStageOpenUrl\(stage\) \|\| stage\.direct_web_url \|\| stage\.target_url \|\| '';/s,
  );
  assert.match(
    html,
    /if \(stage\.use_inline_launch\) \{\s+trackStageClickInBackground\(stage\);\s+if \(launchDirectTarget\(stage\)\) \{\s+return;\s+\}\s+\}\s+if \(launchUrl\) \{/s,
  );
  assert.match(
    html,
    /window\.location\.href = launchUrl;/,
  );
  assert.match(
    html,
    /var nativeLaunchUrl = getNativeAnchorHref\(stage\) \|\| getStageOpenUrl\(stage\) \|\| fallbackUrl \|\| \(\(stage && stage\.direct_web_url\) \|\| \(stage && stage\.target_url\) \|\| ''\);/s,
  );
  assert.match(
    html,
    /var closeStageKey = closeButton\.getAttribute\('data-overlay-close'\) \|\| '';\s+var closeStage = getStageByKey\(closeStageKey\);\s+var closeFallbackUrl = getNativeAnchorHref\(closeStage\) \|\| getStageOpenUrl\(closeStage\) \|\| \(\(closeStage && closeStage\.direct_web_url\) \|\| \(closeStage && closeStage\.target_url\) \|\| ''\);\s+triggerOverlayStageLaunch\(closeStageKey, closeFallbackUrl\);/s,
  );
  assert.match(
    html,
    /var fallbackUrl = launchButton\.getAttribute\('href'\) \|\| getStageOpenUrl\(stage\);\s+triggerOverlayStageLaunch\(stageKey, fallbackUrl\);/s,
  );
  assert.match(
    html,
    /popupTest20sBtn\.hidden = !canShowPopupTestButton \|\| !getStageByKey\('20s'\)/,
  );
});

test("buildArticleFunnelPreviewPage skips inline fallback for TikTok popup 20s iOS in-app OneLink launches", () => {
  const html = __testUtils.buildArticleFunnelPreviewPage(
    {
      title: "Demo",
      stages: [
        {
          stage_key: "20s",
          direct_platform: "tiktok",
          direct_web_url: "https://www.tiktok.com/view/product/123",
          direct_ios_fb_url: "https://snssdk1180.onelink.me/BAuo?af_dp=snssdk1180%3A%2F%2Fec%2Fpdp",
        },
      ],
    },
    "https://example.com/demo",
    "/demo/launch",
    { routeSlug: "demo", showPopupTestButton: true },
    "/demo/bridge",
    "/demo/go",
  );

  assert.match(
    html,
    /var shouldScheduleTikTokInAppFallback =\s+isInApp &&\s+!\(isIOS && isTikTokPopup20s && stage\.direct_ios_fb_url\);/s,
  );
  assert.match(
    html,
    /if \(shouldScheduleTikTokInAppFallback\) \{\s+scheduleLaunchFallback\(\s+tiktokBrowserTarget \|\| stage\.direct_web_url,\s+1500,\s+\{ preferTopLevel: true \},\s+\);\s+\}/s,
  );
});

test("buildArticleFunnelPreviewPage prefers Android app targets for TikTok popup 20s while preserving iOS web-first handling", () => {
  const html = __testUtils.buildArticleFunnelPreviewPage(
    {
      title: "Demo",
      stages: [
        {
          stage_key: "20s",
          direct_platform: "tiktok",
          direct_web_url: "https://vt.tiktok.com/demo/",
          direct_app_url: "snssdk1180://ec/pdp?demo=1",
          direct_android_url: "snssdk1180://ec/pdp?demo=android",
          direct_ios_fb_url:
            "https://snssdk1180.onelink.me/BAuo?af_dp=snssdk1180%3A%2F%2Fec%2Fpdp",
        },
      ],
    },
    "https://example.com/demo",
    "/demo/launch",
    { routeSlug: "demo", showPopupTestButton: true },
    "/demo/bridge",
    "/demo/go",
  );

  assert.match(
    html,
    /var tiktokTarget = isTikTokPopup20s\s+\?\s+\(\s+isIOS\s+\?\s+\(\s+isInApp\s+\?\s+\(stage\.direct_ios_fb_url \|\| tiktokBrowserTarget\)\s+:\s+tiktokBrowserTarget\s+\)\s+:\s+isAndroid\s+\?\s+\(stage\.direct_android_url \|\| stage\.direct_app_url \|\| tiktokBrowserTarget\)\s+:\s+tiktokBrowserTarget\s+\)/s,
  );
  assert.match(
    html,
    /if \(isTikTokPopup20s && isInApp && stage\.direct_ios_fb_url\) \{/,
  );
});

test("buildArticleFunnelPreviewPage uses domain-wide popup dismiss cookies with one-day TTL for every stage", () => {
  const html = __testUtils.buildArticleFunnelPreviewPage(
    {
      title: "Demo",
      stages: [
        {
          stage_key: "3s",
          direct_platform: "shopee",
          direct_web_url: "https://shopee.vn/product/37251933/591989399",
        },
        {
          stage_key: "20s",
          direct_platform: "tiktok",
          direct_web_url: "https://vt.tiktok.com/demo/",
        },
      ],
    },
    "https://example.com/demo",
    "/demo/launch",
    { routeSlug: "demo", showPopupTestButton: true },
    "/demo/bridge",
    "/demo/go",
  );

  assert.match(
    html,
    /function getPopupDismissCookieName\(stageKey\) \{\s+return 'popup_closed_' \+ encodeURIComponent\(String\(stageKey \|\| ''\)\);\s+\}/s,
  );
  assert.match(
    html,
    /function getNextVietnamMidnightTimestamp\(nowMs\) \{\s+var vnOffsetMs = 7 \* 60 \* 60 \* 1000;/s,
  );
  assert.match(
    html,
    /return Date\.UTC\(\s+vnNow\.getUTCFullYear\(\),\s+vnNow\.getUTCMonth\(\),\s+vnNow\.getUTCDate\(\) \+ 1,/s,
  );
  assert.match(
    html,
    /function setPopupDismissCookie\(stageKey\) \{\s+var expiresAt = new Date\(getNextVietnamMidnightTimestamp\(Date\.now\(\)\)\);/s,
  );
  assert.match(
    html,
    /function getPopupDismissStorageKey\(stageKey\) \{\s+return 'popup_closed_until_' \+ encodeURIComponent\(String\(stageKey \|\| ''\)\);\s+\}/s,
  );
  assert.match(
    html,
    /window\.localStorage\.setItem\(\s*getPopupDismissStorageKey\(stageKey\),\s*String\(expiresAt\.getTime\(\)\),\s*\)/s,
  );
});

test("buildArticleFunnelPopupTestUrl produces a usable signed test url", () => {
  const testUrl = __testUtils.buildArticleFunnelPopupTestUrl(
    "demo-post",
    "example.com",
    "https://fallback.example",
    "20s",
    Date.now() + 60_000,
  );
  const parsed = new URL(testUrl);
  assert.equal(parsed.origin, "https://example.com");
  assert.equal(parsed.pathname, "/demo-post");
  assert.equal(parsed.searchParams.get("popup_test"), "20s");
  assert.ok(parsed.searchParams.get("popup_test_token"));
  assert.equal(
    __testUtils.isArticleFunnelPopupTestRequestAllowed(
      {
        query: {
          popup_test: parsed.searchParams.get("popup_test"),
          popup_test_token: parsed.searchParams.get("popup_test_token"),
        },
      },
      "demo-post",
      "20s",
    ),
    true,
  );
});

test("resolveArticleFunnelConfig keeps TikTok short share links instead of expanding them", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch should not run for TikTok short link preservation");
  };
  try {
    const resolved = await __testUtils.resolveArticleFunnelConfig({
      overlay: {
        popup_3s_url: "https://shopee.vn/product/37251933/591989399",
        popup_20s_url: "https://vt.tiktok.com/ZTSHORT456/",
      },
    });
    const stage20s = (resolved.stages || []).find(
      (stage) => String(stage.stage_key) === "20s",
    );
    assert.ok(stage20s);
    assert.equal(stage20s.target_url, "https://vt.tiktok.com/ZTSHORT456/");
    assert.equal(stage20s.direct_web_url, "https://vt.tiktok.com/ZTSHORT456/");
    assert.equal(stage20s.direct_ios_fb_url, "https://vt.tiktok.com/ZTSHORT456/");
  } finally {
    global.fetch = originalFetch;
  }
});
