const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

test("billing uses one payment page and keeps legacy pricing URLs compatible", () => {
  assert.doesNotMatch(indexHtml, /id="page-pricing"/);
  assert.match(indexHtml, /id="page-payment"[\s\S]*?class="pricing-grid"/);
  assert.match(appJs, /if \(raw === "pricing"\) return "payment";/);
});

test("unfinished bio is hidden and team navigation has a conditional hook", () => {
  assert.match(indexHtml, /id="bioNavItem"[^>]*hidden/);
  assert.match(indexHtml, /id="teamNavItem"[^>]*hidden/);
  assert.match(appJs, /function syncWorkspaceNavigation\(\)/);
});

test("primary sidebar navigation uses keyboard-accessible buttons", () => {
  const sidebar = indexHtml.match(/<nav class="snav">([\s\S]*?)<\/nav>/)?.[1] || "";
  assert.doesNotMatch(sidebar, /<div class="sitem/);
  assert.match(sidebar, /<button class="sitem active"/);
});

test("dashboard avoids repeated onboarding navigation blocks", () => {
  const dashboard = indexHtml.match(/id="page-dashboard"([\s\S]*?)id="page-create"/)?.[1] || "";
  assert.doesNotMatch(dashboard, /Lộ trình ngắn/);
  assert.doesNotMatch(dashboard, /Điều hướng nhanh/);
  assert.match(dashboard, /dashboard-primary-actions/);
});

test("QR creation exposes one primary create action", () => {
  const qrPage = indexHtml.match(/id="page-qr"([\s\S]*?)id="page-bio"/)?.[1] || "";
  const createActions = qrPage.match(/onclick="generateQr\(\)"/g) || [];
  assert.equal(createActions.length, 1);
  assert.doesNotMatch(qrPage, /QR 3D/);
});

test("team workspace separates members and shared templates into task tabs", () => {
  const teamPage = indexHtml.match(/id="page-team"([\s\S]*?)id="page-admin"/)?.[1] || "";
  assert.match(teamPage, /data-team-section="members"/);
  assert.match(teamPage, /data-team-section="templates"/);
  assert.match(teamPage, /data-team-panel="members"/);
  assert.match(teamPage, /data-team-panel="templates"/);
  assert.doesNotMatch(teamPage, /Quy trình giao việc/);
  assert.doesNotMatch(teamPage, /Quick action/);
  assert.match(appJs, /function setTeamSection\(section, trigger\)/);
});
