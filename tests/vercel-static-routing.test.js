const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Vercel serves files from public before falling back to the Express function", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"),
  );

  assert.equal("routes" in config, false);
  assert.deepEqual(config.rewrites, [
    { source: "/(.*)", destination: "/api/index.js" },
  ]);
});

test("only API requests receive a guest session cookie", () => {
  const { __testUtils } = require("../api/index");

  assert.equal(__testUtils.shouldAssignGuestSession("/api/shorten"), true);
  assert.equal(__testUtils.shouldAssignGuestSession("/dashboard"), true);
  assert.equal(__testUtils.shouldAssignGuestSession("/abc123"), false);
  assert.equal(__testUtils.shouldAssignGuestSession("/app.js"), false);
});
