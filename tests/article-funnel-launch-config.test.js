const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

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

test("buildOverlayLaunchConfig builds Shopee Android intent config", () => {
  const originalUrl = "https://shopee.vn/product/37251933/591989399";
  const config = __testUtils.buildOverlayLaunchConfig(originalUrl);

  assert.equal(config.direct_platform, "shopee");
  assert.match(config.direct_android_intent_url, /^intent:\/\/shopee\.vn\//);
  assert.equal(config.direct_ios_fb_url, originalUrl);
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
