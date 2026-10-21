const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

const productUrl =
  "https://www.tiktok.com/view/product/1732847264020661556?share_app_id=1180&trackParams=%7B%22source_page_type%22%3A%22product_share%22%7D";

test("regular TikTok product links use HTTPS OneLink on iOS without changing Android", () => {
  const detected = __testUtils.detectPlatformDeep(productUrl, "ios");
  const regularInfo = __testUtils.buildRegularTikTokLinkInfo(
    productUrl,
    detected,
  );

  assert.match(
    regularInfo.deeplink_ios,
    /^https:\/\/snssdk1180\.onelink\.me\/BAuo\?/,
  );
  assert.match(regularInfo.deeplink_ios, /af_dp=snssdk1180%3A%2F%2Fec%2Fpdp/);
  assert.match(regularInfo.deeplink_ios, /af_force_deeplink=true/);
  assert.equal(regularInfo.deeplink_android, detected.deeplink_android);
  assert.match(regularInfo.deeplink_android, /^snssdk1180:\/\/ec\/pdp\?/);
});

test("regular TikTok bridge advertises and opens HTTPS OneLink for iOS", () => {
  const regularInfo = __testUtils.buildRegularTikTokLinkInfo(
    productUrl,
    __testUtils.detectPlatformDeep(productUrl, "ios"),
  );
  const html = __testUtils.buildDirectBridgePage(
    {
      original_url: productUrl,
      og_title: "TikTok Shop demo",
      og_desc: "Demo",
      og_image: "",
    },
    "https://example.com/tiktok-demo",
    regularInfo,
  );

  assert.match(
    html,
    /<meta property="al:ios:url" content="https:\/\/snssdk1180\.onelink\.me\/BAuo\?[^\"]*af_force_deeplink=true[^\"]*" \/>/,
  );
  assert.match(
    html,
    /var iosUrl\s+= "https:\/\/snssdk1180\.onelink\.me\/BAuo\?[^\"]*af_force_deeplink=true[^\"]*";/,
  );
  assert.match(html, /var androidUrl\s+= "snssdk1180:\/\/ec\/pdp\?/);
});

test("Facebook crawler metadata uses HTTPS OneLink for regular TikTok products", () => {
  const html = __testUtils.buildOgPage(
    {
      alias: "tiktok-demo",
      short_code: "abc123",
      link_type: "direct",
      original_url: productUrl,
      og_title: "TikTok Shop demo",
      og_desc: "Demo",
      og_image: "",
    },
    "https://example.com",
  );

  assert.match(
    html,
    /<meta property="al:ios:url" content="https:\/\/snssdk1180\.onelink\.me\/BAuo\?[^\"]*af_force_deeplink=true[^\"]*" \/>/,
  );
  assert.match(
    html,
    /<meta property="al:android:url" content="snssdk1180:\/\/ec\/pdp\?/,
  );
});

test("regular TikTok video links keep their existing app scheme behavior", () => {
  const videoUrl = "https://www.tiktok.com/@demo/video/1234567890123456789";
  const detected = __testUtils.detectPlatformDeep(videoUrl, "ios");
  const regularInfo = __testUtils.buildRegularTikTokLinkInfo(videoUrl, detected);

  assert.deepEqual(regularInfo, detected);
});
