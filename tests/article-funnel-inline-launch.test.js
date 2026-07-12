const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("shouldUseArticleFunnelInlineLaunch enables Shopee 3s only", () => {
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

test("buildArticleFunnelPreviewPage embeds inline launch metadata for published Shopee 3s", () => {
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
  assert.match(html, /openViaAnchor\(iosTarget, '_blank', 'noopener'\)/);
  assert.match(html, /function scheduleLaunchFallback\(fallbackUrl, delayMs\)/);
  assert.match(html, /window\.addEventListener\('pagehide', markLeft, true\)/);
  assert.match(html, /window\.addEventListener\('blur', markLeft, true\)/);
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

test("buildArticleFunnelPreviewPage routes TikTok 20s through dedicated bridge url", () => {
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
    /"stage_key":"20s","direct_platform":"tiktok","direct_web_url":"https:\/\/vt\.tiktok\.com\/demo\/","use_inline_launch":false/,
  );
  assert.match(html, /var bridgeBasePath = "\/demo\/bridge"/);
  assert.match(html, /getBridgeUrl\(stage\) \|\| getLaunchUrl\(stage\)/);
  assert.match(
    html,
    /return shouldUseDedicatedBridgeRoute\(stage\) &&\s+isIOSDevice\(\) &&\s+isInAppBrowser\(\);/,
  );
  assert.match(
    html,
    /function getNativeAnchorTarget\(stage\) \{\s+return '_self';\s+\}/,
  );
  assert.match(
    html,
    /function triggerOverlayStageLaunch\(stageKey, fallbackUrl\) \{\s+var stage = getStageByKey\(stageKey\);/s,
  );
  assert.match(
    html,
    /if \(shouldUseNativeLaunchRoute\(stage\)\) \{\s+setPopupDismissCookie\(stageKey\);\s+removeStage\(stageKey\);\s+if \(openViaAnchor\(/s,
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
