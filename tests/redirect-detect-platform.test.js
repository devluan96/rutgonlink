const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("detectPlatformDeep recognizes vm.tiktok.com short links as TikTok", () => {
  const originalUrl = "https://vm.tiktok.com/ZMSHORT123/";
  const detected = __testUtils.detectPlatformDeep(originalUrl, "ios");

  assert.equal(detected.platform_name, "tiktok");
  assert.equal(detected.deeplink, originalUrl);
  assert.equal(detected.fallback, originalUrl);
});

test("detectPlatformDeep recognizes vt.tiktok.com short links as TikTok", () => {
  const originalUrl = "https://vt.tiktok.com/ZTSHORT456/";
  const detected = __testUtils.detectPlatformDeep(originalUrl, "android");

  assert.equal(detected.platform_name, "tiktok");
  assert.equal(detected.deeplink, originalUrl);
  assert.equal(detected.fallback, originalUrl);
});

test("detectPlatformDeep still builds TikTok app schemes for canonical video links", () => {
  const originalUrl = "https://www.tiktok.com/@demo/video/1234567890123456789";
  const detected = __testUtils.detectPlatformDeep(originalUrl, "android");

  assert.equal(detected.platform_name, "tiktok");
  assert.equal(
    detected.deeplink,
    "snssdk1233://aweme/detail/?aweme_id=1234567890123456789",
  );
  assert.equal(detected.fallback, originalUrl);
});
