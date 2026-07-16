const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("buildTikTokAppScheme converts TikTok product links into snssdk1180 app deeplinks", () => {
  const originalUrl =
    "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180&chain_key=%7B%22t%22%3A1%7D&trackParams=%7B%22enter_from_info%22%3A%22product_share_outside%22%7D";
  const deeplink = __testUtils.buildTikTokAppScheme(originalUrl);

  assert.match(deeplink, /^snssdk1180:\/\/ec\/pdp/i);
  assert.match(
    deeplink,
    /requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D/,
  );
  assert.match(
    deeplink,
    /params_url=https%3A%2F%2Fwww\.tiktok\.com%2Fview%2Fproduct%2F1731062681949079816/i,
  );
});

test("buildOverlayLaunchConfig keeps TikTok iOS in-app target app-first", () => {
  const originalUrl = "https://www.tiktok.com/@demo/video/1234567890123456789";
  const config = __testUtils.buildOverlayLaunchConfig(originalUrl);

  assert.equal(config.direct_platform, "tiktok");
  assert.equal(
    config.direct_ios_fb_url,
    "snssdk1233://aweme/detail/?aweme_id=1234567890123456789",
  );
  assert.equal(config.direct_ios_browser_url, originalUrl);
});

test("buildDirectLaunchConfig stays web-first for regular TikTok deeplink flow", () => {
  const originalUrl = "https://www.tiktok.com/@demo/video/1234567890123456789";
  const config = __testUtils.buildDirectLaunchConfig(originalUrl);

  assert.equal(config.direct_platform, "tiktok");
  assert.equal(config.direct_ios_fb_url, originalUrl);
  assert.equal(config.direct_ios_browser_url, originalUrl);
});

test("buildOverlayLaunchConfig keeps TikTok short links as browser fallback", () => {
  const originalUrl = "https://vt.tiktok.com/ZTSHORT456/";
  const config = __testUtils.buildOverlayLaunchConfig(originalUrl);

  assert.equal(config.direct_platform, "tiktok");
  assert.equal(config.direct_ios_fb_url, originalUrl);
  assert.equal(config.direct_ios_browser_url, originalUrl);
  assert.equal(config.direct_android_url, originalUrl);
});

test("buildOverlayLaunchConfig keeps TikTok product links web-first for iOS in-app", () => {
  const originalUrl =
    "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180";
  const config = __testUtils.buildOverlayLaunchConfig(originalUrl);

  assert.equal(config.direct_platform, "tiktok");
  assert.equal(config.direct_ios_fb_url, originalUrl);
  assert.equal(config.direct_ios_browser_url, originalUrl);
  assert.match(config.direct_app_url, /^snssdk1180:\/\/ec\/pdp/i);
});

test("applyArticleFunnelStageDirectOverrides lets TikTok 20s use a dedicated iPhone/Facebook target", () => {
  const originalUrl =
    "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180";
  const overrideUrl = "https://vt.tiktok.com/ZTAPPDIRECT/";
  const config = __testUtils.applyArticleFunnelStageDirectOverrides(
    {
      stage_key: "20s",
    },
    __testUtils.buildOverlayLaunchConfig(originalUrl),
    {
      overlay: {
        popup_20s_ios_fb_url: overrideUrl,
      },
    },
  );

  assert.equal(config.direct_platform, "tiktok");
  assert.equal(config.direct_web_url, originalUrl);
  assert.equal(config.direct_ios_fb_url, overrideUrl);
  assert.equal(config.direct_ios_browser_url, originalUrl);
});

test("buildArticleFunnelPopup20sDirectBridgeInfo keeps HongHotDuong-style TikTok targets for popup 20s", () => {
  const originalUrl =
    "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180";
  const bridgeInfo = __testUtils.buildArticleFunnelPopup20sDirectBridgeInfo(
    {
      stage_key: "20s",
      direct_ios_fb_url: "https://vt.tiktok.com/ZTWEBFIRST/",
      direct_ios_browser_url: originalUrl,
    },
    originalUrl,
    __testUtils.detectPlatformDeep(originalUrl, "ios"),
  );

  assert.equal(bridgeInfo.platform_name, "tiktok");
  assert.equal(bridgeInfo.deeplink, "https://vt.tiktok.com/ZTWEBFIRST/");
  assert.equal(bridgeInfo.deeplink_ios, "https://vt.tiktok.com/ZTWEBFIRST/");
  assert.equal(bridgeInfo.popup20s_ios_inapp_url, "https://vt.tiktok.com/ZTWEBFIRST/");
  assert.equal(bridgeInfo.popup20s_browser_url, originalUrl);
  assert.equal(bridgeInfo.fallback, originalUrl);
});

test("buildArticleFunnelPopup20sTikTokBridgePage sends iOS in-app to override and others to browser url", () => {
  const html = __testUtils.buildArticleFunnelPopup20sTikTokBridgePage(
    {
      original_url:
        "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180",
      og_title: "Demo",
      og_desc: "Bridge demo",
      og_image: "",
    },
    "https://example.com/demo/bridge/20s",
    {
      popup20s_browser_url: "https://vt.tiktok.com/ZTBROWSER123/",
      popup20s_ios_inapp_url:
        "https://snssdk1180.onelink.me/demo?af_dp=snssdk1180%3A%2F%2Fec%2Fpdp",
    },
  );

  assert.match(
    html,
    /var browserUrl = "https:\/\/vt\.tiktok\.com\/ZTBROWSER123\/";/,
  );
  assert.match(
    html,
    /var iosInAppUrl = "https:\/\/snssdk1180\.onelink\.me\/demo\?af_dp=snssdk1180%3A%2F%2Fec%2Fpdp";/,
  );
  assert.match(
    html,
    /if \(isIOS && isInApp\) \{\s+openSameWindow\(iosInAppUrl \|\| browserUrl \|\| fallbackUrl\);/s,
  );
  assert.match(
    html,
    /if \(browserUrl\) \{\s+openSameWindow\(browserUrl\);/s,
  );
});

test("buildOverlayLaunchConfig builds Shopee Android intent config", () => {
  const originalUrl = "https://shopee.vn/product/37251933/591989399";
  const config = __testUtils.buildOverlayLaunchConfig(originalUrl);

  assert.equal(config.direct_platform, "shopee");
  assert.match(config.direct_android_intent_url, /^intent:\/\/shopee\.vn\//);
  assert.equal(
    config.direct_ios_fb_url,
    "https://shopee.vn/opaanlp/37251933/591989399?__mobile__=1",
  );
  assert.equal(config.direct_ios_browser_url, originalUrl);
});

test("buildDirectLaunchConfig keeps Shopee affiliate params on the FB iPhone web-first url", () => {
  const originalUrl =
    "https://shopee.vn/product/37251933/591989399?mmp_pid=an_123&utm_source=an_123";
  const config = __testUtils.buildDirectLaunchConfig(originalUrl);

  assert.equal(config.direct_platform, "shopee");
  assert.match(
    config.direct_ios_fb_url,
    /^https:\/\/shopee\.vn\/opaanlp\/37251933\/591989399\?/,
  );
  assert.match(config.direct_ios_fb_url, /mmp_pid=an_123/);
  assert.match(config.direct_ios_fb_url, /utm_source=an_123/);
  assert.match(config.direct_ios_fb_url, /__mobile__=1/);
  assert.equal(config.direct_ios_browser_url, originalUrl);
});

test("normalizeArticleFunnelPreviewConfig omits 20s stage when popup 20s URL is empty", () => {
  const config = __testUtils.normalizeArticleFunnelPreviewConfig({
    baseUrl: "https://shopee.vn/product/37251933/591989399",
    overlay: {
      popup_3s_url: "https://shopee.vn/product/37251933/591989399",
      popup_20s_url: "",
      popup_300s_url: "https://example.com/fallback-300s",
    },
  });

  assert.equal(
    config.stages.some((stage) => String(stage.stage_key) === "20s"),
    false,
  );
  assert.equal(
    config.stages.some((stage) => String(stage.stage_key) === "3s"),
    true,
  );
  assert.equal(
    config.stages.some((stage) => String(stage.stage_key) === "300s"),
    true,
  );
});

test("normalizeArticleFunnelPreviewConfig omits 300s stage when popup 300s URL is empty", () => {
  const config = __testUtils.normalizeArticleFunnelPreviewConfig({
    baseUrl: "https://shopee.vn/product/37251933/591989399",
    overlay: {
      popup_3s_url: "https://shopee.vn/product/37251933/591989399",
      popup_20s_url: "",
      popup_300s_url: "",
    },
  });

  assert.equal(
    config.stages.some((stage) => String(stage.stage_key) === "300s"),
    false,
  );
  assert.equal(
    config.stages.some((stage) => String(stage.stage_key) === "3s"),
    true,
  );
});
