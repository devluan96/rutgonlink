const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

function extractInlineIifeScriptBody(html) {
  const match = html.match(
    /<script>\s*\(function\(\) \{([\s\S]*?)\}\)\(\);\s*<\/script>/,
  );
  assert.ok(match, "expected inline bridge script");
  return match[1];
}

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
      direct_ios_url:
        "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
      direct_ios_browser_url: originalUrl,
    },
    originalUrl,
    __testUtils.detectPlatformDeep(originalUrl, "ios"),
  );

  assert.equal(bridgeInfo.platform_name, "tiktok");
  assert.equal(bridgeInfo.deeplink, "https://vt.tiktok.com/ZTWEBFIRST/");
  assert.equal(bridgeInfo.deeplink_ios, "https://vt.tiktok.com/ZTWEBFIRST/");
  assert.equal(bridgeInfo.popup20s_ios_inapp_url, "https://vt.tiktok.com/ZTWEBFIRST/");
  assert.equal(bridgeInfo.popup20s_browser_url, "https://vt.tiktok.com/ZTWEBFIRST/");
  assert.equal(bridgeInfo.ios_inapp_browser_fallback, "https://vt.tiktok.com/ZTWEBFIRST/");
  assert.equal(bridgeInfo.fallback, "https://vt.tiktok.com/ZTWEBFIRST/");
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
    /if \(isIOS && isInApp\) \{[\s\S]*?openSameWindow\(iosInAppUrl \|\| browserUrl \|\| fallbackUrl\);/s,
  );
  assert.match(
    html,
    /if \(isIOS && isInApp\) \{[\s\S]*?var iosInAppPromptFallbackDelayMs = 4500;[\s\S]*?delay_ms: String\(iosInAppPromptFallbackDelayMs\)/s,
  );
  assert.match(
    html,
    /if \(browserUrl\) \{[\s\S]*?openSameWindow\(browserUrl\);/s,
  );
});

test("buildDirectBridgePage renders bridge diagnostics when popup debug is enabled", () => {
  const html = __testUtils.buildDirectBridgePage(
    {
      original_url:
        "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180",
      og_title: "Demo",
      og_desc: "Bridge demo",
      og_image: "",
    },
    "https://example.com/demo/launch/20s",
    {
      platform_name: "tiktok",
      deeplink:
        "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
      deeplink_ios:
        "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
      deeplink_android:
        "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
      fallback:
        "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180",
      bridge_debug: {
        enabled: true,
        request_id: "req_popup20_debug_123",
        mode: "article-funnel-launch-tiktok-direct-bridge",
        stage_key: "20s",
        route_slug: "demo-post",
        target_url:
          "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
        fallback_url:
          "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180",
        debug_api_url: "/api/article-funnel/bridge-debug",
      },
    },
  );

  assert.match(html, /id="bridgeStatusText"/);
  assert.match(html, /id="bridgeDebugPanel" hidden/);
  assert.match(
    html,
    /var bridgeDebug = \{"enabled":true,"request_id":"req_popup20_debug_123","mode":"article-funnel-launch-tiktok-direct-bridge"/,
  );
  assert.match(
    html,
    /var iosInAppFallbackUrl = "https:\/\/www\.tiktok\.com\/view\/product\/1731062681949079816\?share_app_id=1180";/,
  );
  assert.match(
    html,
    /navigator\.sendBeacon\(bridgeDebug\.debug_api_url, beaconBody\)/,
  );
  assert.match(
    html,
    /emitBridgeDebug\('bridge_page_rendered'/,
  );
  assert.match(
    html,
    /emitBridgeDebug\('attempt_open_app', \{ target: iosUrl, branch: 'ios_inapp_tiktok' \}\);/,
  );
  assert.match(
    html,
    /var iosInAppPromptFallbackDelayMs = 4500;/,
  );
  assert.match(
    html,
    /emitBridgeDebug\('fallback_to_web', \{ fallback_url: fallbackTarget \}\);/,
  );
  assert.doesNotThrow(() => {
    new Function(extractInlineIifeScriptBody(html));
  });
});

test("resolveTikTokIosInAppTargets prefers app deeplink before TikTok override links", () => {
  const resolved = __testUtils.resolveTikTokIosInAppTargets(
    {
      direct_ios_fb_url: "https://vt.tiktok.com/ZTAPPFALLBACK/",
      direct_ios_browser_url:
        "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180",
      direct_ios_url:
        "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
      direct_app_url:
        "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
    },
    "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180",
    __testUtils.detectPlatformDeep(
      "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180",
      "ios",
    ),
  );

  assert.match(resolved.appTarget, /^snssdk1180:\/\/ec\/pdp/i);
  assert.equal(resolved.browserFallback, "https://vt.tiktok.com/ZTAPPFALLBACK/");
  assert.equal(
    resolved.webFallback,
    "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180",
  );
});

test("applyArticleFunnelStageDirectOverrides auto-wraps TikTok popup 20s product links with BAuo OneLink", () => {
  const originalUrl =
    "https://www.tiktok.com/view/product/1732847264020661556?share_app_id=1180&unique_id=diemthichriviu";
  const config = __testUtils.applyArticleFunnelStageDirectOverrides(
    {
      stage_key: "20s",
    },
    __testUtils.buildOverlayLaunchConfig(originalUrl),
    {},
  );

  assert.equal(config.direct_platform, "tiktok");
  assert.match(config.direct_ios_fb_url, /^https:\/\/snssdk1180\.onelink\.me\/BAuo\?/);
  assert.equal(config.direct_web_url, originalUrl);
  assert.equal(config.direct_ios_browser_url, originalUrl);
  assert.match(config.direct_ios_fb_url, /requestParams=/);
  assert.match(config.direct_ios_fb_url, /1732847264020661556/);
});

test("resolveTikTokIosInAppTargets prefers BAuo override for popup 20s iOS in-app flow", () => {
  const originalUrl =
    "https://www.tiktok.com/view/product/1731062681949079816?share_app_id=1180";
  const resolved = __testUtils.resolveTikTokIosInAppTargets(
    {
      stage_key: "20s",
      direct_ios_fb_url:
        "https://snssdk1180.onelink.me/BAuo?af_dp=snssdk1180%3A%2F%2Fec%2Fpdp",
      direct_ios_browser_url: originalUrl,
      direct_ios_url:
        "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
      direct_app_url:
        "snssdk1180://ec/pdp?biz_type=0&requestParams=%7B%22product_id%22%3A%5B%221731062681949079816%22%5D%7D",
    },
    originalUrl,
    __testUtils.detectPlatformDeep(originalUrl, "ios"),
  );

  assert.equal(
    resolved.appTarget,
    "https://snssdk1180.onelink.me/BAuo?af_dp=snssdk1180%3A%2F%2Fec%2Fpdp",
  );
  assert.equal(
    resolved.browserFallback,
    "https://snssdk1180.onelink.me/BAuo?af_dp=snssdk1180%3A%2F%2Fec%2Fpdp",
  );
});

test("buildDirectBridgePage emits a parseable script for long TikTok popup 20s urls", () => {
  const originalUrl =
    "https://www.tiktok.com/view/product/1730922303991548451?_d=el72geal3i4981&_svg=1&chain_key=%7B%22t%22%3A1%2C%22k%22%3A%22000000000000000007663149517492340501%22%2C%22sc%22%3A%22copy%22%7D&checksum=c9ef567daf6fcc12cdd83ed8e8130853fbb7fddce1de58986234492ba372852c&encode_params=MIIBUwQMp-TQCDxpB8-_bD40BIIBL6hWnZ6B22Fl_agbJveySIUg8uvcenJa-XWXSG0reekqYSIcujWmVoCSgnNH3JaDBzXJrISWDm0_TkK9UGewAeoMgO62_ojd_x2J9X1hz8QNfG98KhGp2eAsyxgioijK2y-86H7dXcXqSYnD3C-e_rvS95PJcOPsZCvjmNHLsYSEF7aecliA6zBtRU3ID-nHMZ7dQ_ntFPTCgXr0nuKqFIklaFuVGhm4yKg9IMDoxQeYQl4tV6Ng4rLwdE7z7t9ub5X7X_cp-16AYOiDOO4BdG9cwrQs-4QtIZBiO_spjJ8lcqdYcW1h67fUN-BmymjLluQuM-1VUnfKX9I3iCbhwUB3Q1P-P0BOW7zcDlYftFKnJJJjv_JBhJUFB1maHSYL7MqSkSMfhWLvgIBUEv3joQQQOcVCWUAspKVwFIiSGQlo2A%3D%3D&og_info=%7B%22title%22%3A%22Kh%E1%BA%A9u+trang+Anti+UV+Cool+mask+-+UNICARE+Combo+2%2C+3%2C+4+Chi%E1%BA%BFc+Kh%E1%BA%A9u+Trang+Ch%E1%BB%91ng+N%E1%BA%AFng+1+l%E1%BB%9Bp+UPF50++%7C+Che+ph%E1%BB%A7+k%C3%ADn+g%C3%B2+m%C3%A1+%7C+M%C3%A1t+l%E1%BA%A1nh%2C+tho%C3%A1ng+kh%C3%AD+%7C+Logo+%C4%91%E1%BB%95i+m%C3%A0u+UV%22%2C%22image%22%3A%22https%3A%5C%2F%5C%2Fp16-oec-sg.ibyteimg.com%5C%2Ftos-alisg-i-aphluv4xwc-sg%5C%2Fa0396b5e7b3e4c57a6bb70fb391e1800~tplv-aphluv4xwc-resize-webp%3A260%3A260.webp%3Fdr%3D15582%26t%3D555f072d%26ps%3D933b5bde%26shp%3D7745054a%26shcp%3D9b759fb9%26idc%3Dmy2%26from%3D2001012042%22%7D&sec_user_id=MS4wLjABAAAAAWJY5YYg6pBbgsjTWbcMfiOvzt5lE8mZgSeOTaKhosfvToZuTH9hnNfO-taeS_W2&share_app_id=1180&share_link_id=FCD20C1A-60E7-4EF7-B818-BFA5165857AE&share_region=VN&social_share_type=15&timestamp=1784216053&trackParams=%7B%22enable_shop_tab_popup%22%3A1%2C%22device_id%22%3A%227523498653488580152%22%2C%22enter_from_info%22%3A%22product_share_outside%22%2C%22source_page_type%22%3A%22product_share%22%7D&tt_from=copy&u_code=E0J5MCC3F2EIL7&ug_btm=b0%2Cb6661&unique_id=diemthichriviu&user_id=7074860191556649986&utm_campaign=client_share&utm_medium=ios&utm_source=copy";
  const info = __testUtils.detectPlatformDeep(originalUrl, "ios");
  const html = __testUtils.buildDirectBridgePage(
    {
      original_url: originalUrl,
      og_title: "Demo",
      og_desc: "Bridge demo",
      og_image: "",
    },
    "https://example.com/demo/launch/20s",
    {
      ...info,
      deeplink: "https://vt.tiktok.com/ZS9MK75nsrBWW-9I4UI/",
      deeplink_ios: "https://vt.tiktok.com/ZS9MK75nsrBWW-9I4UI/",
      deeplink_android: info.deeplink_android || info.deeplink || originalUrl,
      fallback: originalUrl,
      bridge_debug: {
        enabled: true,
        request_id: "debug123",
        mode: "article-funnel-launch-tiktok-direct-bridge",
        stage_key: "20s",
        route_slug: "demo-post",
        target_url: "https://vt.tiktok.com/ZS9MK75nsrBWW-9I4UI/",
        fallback_url: originalUrl,
        debug_api_url: "/api/article-funnel/bridge-debug",
      },
    },
  );

  assert.doesNotThrow(() => {
    new Function(extractInlineIifeScriptBody(html));
  });
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

test("normalizeArticleFunnelPreviewConfig preserves explicit Shopee popup 3s FB iPhone override", () => {
  const config = __testUtils.normalizeArticleFunnelPreviewConfig({
    overlay: {
      popup_3s_url: "https://s.shopee.vn/short-3s",
      popup_3s_ios_fb_url:
        "https://shopee.vn/opaanlp/37251933/591989399?__mobile__=1&mmp_pid=an_123",
    },
  });

  const stage3s = config.stages.find((stage) => stage.stage_key === "3s");
  assert.ok(stage3s);
  assert.equal(stage3s.direct_platform, "shopee");
  assert.equal(stage3s.target_url, "https://s.shopee.vn/short-3s");
  assert.equal(
    stage3s.direct_ios_fb_url,
    "https://shopee.vn/opaanlp/37251933/591989399?__mobile__=1&mmp_pid=an_123",
  );
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
