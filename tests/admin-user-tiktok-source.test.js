const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { __testUtils } = require("../api/index");

test("buildAdminTikTokSourceOverrideUpdate saves and restores the exact user link target", () => {
  const link = {
    original_url: "https://shop.example.com/product-123",
    admin_tiktok_source_original_url: null,
  };

  const enabled = __testUtils.buildAdminTikTokSourceOverrideUpdate(
    link,
    "https://vt.tiktok.com/ZTADMIN/",
    true,
  );
  assert.deepEqual(enabled, {
    original_url: "https://vt.tiktok.com/ZTADMIN/",
    admin_tiktok_source_original_url: "https://shop.example.com/product-123",
  });

  const disabled = __testUtils.buildAdminTikTokSourceOverrideUpdate(
    { ...link, ...enabled },
    "https://vt.tiktok.com/ZTADMIN/",
    false,
  );
  assert.deepEqual(disabled, {
    original_url: "https://shop.example.com/product-123",
    admin_tiktok_source_original_url: null,
  });
});

test("admin user modal exposes per-link TikTok source controls backed by admin-only routes", () => {
  const root = path.join(__dirname, "..");
  const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const appCss = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");
  const apiJs = fs.readFileSync(path.join(root, "api", "index.js"), "utf8");
  const dbJs = fs.readFileSync(path.join(root, "api", "db.js"), "utf8");

  assert.match(indexHtml, /id="adminUserDetailModal"/);
  assert.match(indexHtml, /id="adminUserLinksList"/);
  assert.match(appJs, /function loadAdminUserDetailLinks\(userId\)/);
  assert.match(appJs, /function toggleAdminUserLinkTikTokSource\(/);
  assert.match(appJs, /clickCount\.toLocaleString\("vi-VN"\).*lượt click/);
  assert.match(appCss, /\.admin-user-links-list\s*\{[\s\S]*?max-height:\s*min\(42vh, 360px\);/);
  assert.match(appCss, /\.admin-user-link-source\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/);
  assert.match(apiJs, /app\.get\("\/api\/admin\/users\/:id\/links", requireAdmin/);
  assert.match(apiJs, /\/api\/admin\/users\/:userId\/links\/:linkId\/tiktok-source/);
  assert.match(dbJs, /admin_tiktok_source_original_url/);
});
