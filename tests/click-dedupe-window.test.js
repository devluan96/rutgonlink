const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/db");

test("short-link raw click dedupe window is tightened to five minutes", () => {
  assert.equal(__testUtils.CLICK_DEDUP_WINDOW_MS, 5 * 60 * 1000);
});
