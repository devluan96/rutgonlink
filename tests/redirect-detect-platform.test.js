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

test("detectPlatformDeep recognizes Shopee canonical product paths as product deeplinks", () => {
  const originalUrl = "https://shopee.vn/product/131477471/22466400575";
  const detected = __testUtils.detectPlatformDeep(originalUrl, "ios");

  assert.equal(detected.platform_name, "shopee");
  assert.equal(
    detected.deeplink,
    "https://shopee.vn/universal-link/product/131477471/22466400575",
  );
  assert.equal(detected.fallback, originalUrl);
});

test("detectPlatformDeep keeps Shopee affiliate tracking params on canonical product paths", () => {
  const originalUrl =
    "https://shopee.vn/product/131477471/22466400575?mmp_pid=an_17358580605&utm_source=an_17358580605";
  const detected = __testUtils.detectPlatformDeep(originalUrl, "android");

  assert.equal(detected.platform_name, "shopee");
  assert.equal(detected.deeplink, originalUrl);
  assert.equal(detected.deeplink_android, originalUrl);
  assert.equal(detected.fallback, originalUrl);
});

test("canonicalizeShopeeProductUrl rewrites opaanlp links into canonical product links", () => {
  const normalized = __testUtils.canonicalizeShopeeProductUrl(
    "https://shopee.vn/opaanlp/131477471/22466400575?__mobile__=1&mmp_pid=an_17358580605&utm_source=an_17358580605",
  );

  assert.equal(
    normalized,
    "https://shopee.vn/product/131477471/22466400575?mmp_pid=an_17358580605&utm_source=an_17358580605",
  );
});

test("canonicalizeShopeeProductUrl rewrites universal-link product urls into canonical product links", () => {
  const normalized = __testUtils.canonicalizeShopeeProductUrl(
    "https://shopee.vn/universal-link/product/131477471/22466400575?utm_medium=affiliates",
  );

  assert.equal(
    normalized,
    "https://shopee.vn/product/131477471/22466400575?utm_medium=affiliates",
  );
});
