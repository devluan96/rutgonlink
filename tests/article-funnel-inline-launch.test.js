const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("shouldUseArticleFunnelInlineLaunch enables Shopee 3s and TikTok 20s", () => {
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
    /scheduleLaunchFallback\(\s+stage\.direct_web_url,\s+isInApp \? 1500 : 1600,\s+\{ preferTopLevel: isInApp \},\s+\);/s,
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

test("buildArticleFunnelPreviewPage launches TikTok 20s inline like HongHotDuong", () => {
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
  );

  assert.match(
    html,
    /"stage_key":"20s","direct_platform":"tiktok","direct_web_url":"https:\/\/vt\.tiktok\.com\/demo\/","use_inline_launch":true/,
  );
  assert.match(html, /var bridgeBasePath = "\/demo\/bridge"/);
  assert.match(html, /function shouldUseDedicatedBridgeRoute\(stage\) \{\s+return false;\s+\}/);
  assert.match(
    html,
    /function getStageOpenUrl\(stage\) \{\s+return shouldUseDedicatedBridgeRoute\(stage\)\s+\? \(getBridgeUrl\(stage\) \|\| getLaunchUrl\(stage\)\)\s+:\s+getLaunchUrl\(stage\);\s+\}/s,
  );
  assert.match(
    html,
    /function getNativeAnchorHref\(stage\) \{\s+if \(!stage\) return '';\s+if \(stage\.use_inline_launch\) \{\s+if \(\s+String\(stage\.direct_platform \|\| ''\)\.toLowerCase\(\) === 'tiktok' &&\s+String\(stage\.stage_key \|\| ''\) === '20s'\s+\) \{\s+if \(isIOSDevice\(\)\) \{\s+return isInAppBrowser\(\)\s+\? \(stage\.direct_ios_fb_url \|\| stage\.direct_ios_browser_url \|\| stage\.direct_web_url \|\| stage\.target_url \|\| ''\)\s+:\s+\(stage\.direct_ios_browser_url \|\| stage\.direct_web_url \|\| stage\.target_url \|\| ''\);\s+\}\s+return stage\.direct_web_url \|\| stage\.direct_android_url \|\| stage\.target_url \|\| '';\s+\}\s+return stage\.direct_web_url \|\| stage\.target_url \|\| '';\s+\}\s+return getStageOpenUrl\(stage\) \|\| stage\.direct_web_url \|\| '#';\s+\}/s,
  );
  assert.match(
    html,
    /var launchUrl = fallbackUrl \|\| getStageOpenUrl\(stage\) \|\| stage\.direct_web_url \|\| stage\.target_url \|\| '';/s,
  );
  assert.match(
    html,
    /var isTikTokPopup20s = String\(stage\.stage_key \|\| ''\) === '20s';\s+var tiktokBrowserTarget =\s+stage\.direct_ios_browser_url \|\| stage\.direct_web_url \|\| targetUrl;/s,
  );
  assert.match(
    html,
    /var directAppTarget =\s+isInApp && !isTikTokPopup20s\s+\? getNativePopupDirectAppLaunchUrl\(stage\)\s+: '';/s,
  );
  assert.match(
    html,
    /scheduleLaunchFallback\(\s+tiktokBrowserTarget \|\| stage\.direct_web_url,\s+1500,\s+\{ preferTopLevel: true \},\s+\);/s,
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
