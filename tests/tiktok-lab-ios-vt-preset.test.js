const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("TikTok VT Lab preset accepts only TikTok short links", () => {
  assert.equal(
    __testUtils.normalizeTikTokLabIosVtUrl("https://vt.tiktok.com/ZS9fNuk1m52Va/"),
    "https://vt.tiktok.com/ZS9fNuk1m52Va/",
  );
  assert.equal(
    __testUtils.normalizeTikTokLabIosVtUrl("https://vm.tiktok.com/ZMdemo/"),
    "https://vm.tiktok.com/ZMdemo/",
  );
  assert.equal(
    __testUtils.normalizeTikTokLabIosVtUrl("https://www.tiktok.com/@demo/video/1"),
    "",
  );
});

test("TikTok VT Lab preset replaces legacy OneLink values in popup and overlay", () => {
  const vtUrl = "https://vt.tiktok.com/ZS9fNuk1m52Va/";
  const config = __testUtils.applyUserTikTokIosLabVtPreset(
    {
      popup20sIosFbUrl: "https://snssdk1180.onelink.me/BAuo/legacy",
      overlay: {
        popup_20s_ios_fb_url: "https://snssdk1180.onelink.me/BAuo/legacy-overlay",
      },
    },
    { affiliate_tiktok_ios_lab_vt_url: vtUrl },
  );

  assert.equal(config.popup20sIosFbUrl, vtUrl);
  assert.equal(config.popup_20s_ios_fb_url, vtUrl);
  assert.equal(config.overlay.popup_20s_ios_fb_url, vtUrl);
});

test("TikTok VT Lab preset has a dedicated database column", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const schemaSql = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "schema.sql"),
    "utf8",
  );
  const migrationSql = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "supabase",
      "migrations",
      "20261126_add_tiktok_ios_lab_vt_affiliate.sql",
    ),
    "utf8",
  );

  assert.match(schemaSql, /affiliate_tiktok_ios_lab_vt_url TEXT/);
  assert.match(migrationSql, /affiliate_tiktok_ios_lab_vt_url TEXT/);
});
