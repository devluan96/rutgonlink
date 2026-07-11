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
    { routeSlug: "demo" },
    "/demo/bridge",
  );

  assert.match(html, /"use_inline_launch":true/);
  assert.match(html, /\/api\/article-funnel\/track-click/);
  assert.match(html, /"demo"/);
  assert.match(html, /id="popupTest3sBtn"/);
  assert.match(html, /Mở popup 3s/);
  assert.match(html, /openViaAnchor\(iosTarget, '_blank', 'noopener'\)/);
});

test("buildArticleFunnelPreviewPage keeps popup test button hidden when 3s stage is missing", () => {
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

  assert.match(html, /popupTest3sBtn\.hidden = !getStageByKey\('3s'\)/);
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
    { routeSlug: "demo" },
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
    /return shouldUseNativeLaunchRoute\(stage\) \? '_blank' : '_self';/,
  );
  assert.match(
    html,
    /if \(shouldUseNativeLaunchRoute\(stage\) &&\s+openViaAnchor\(\s+launchUrl,\s+getNativeAnchorTarget\(stage\),\s+getNativeAnchorRel\(stage\)\s+\)\) \{\s+return;\s+\}/,
  );
});
