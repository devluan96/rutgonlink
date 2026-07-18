const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "app.js"),
  "utf8",
);
const cssSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "app.css"),
  "utf8",
);

test("sidebar toggle uses the same drawer breakpoint as the responsive CSS", () => {
  assert.match(
    appSource,
    /const SIDEBAR_DRAWER_BREAKPOINT_PX = 1024;/,
  );
  assert.match(
    appSource,
    /function shouldUseSidebarDrawerViewport\(\)/,
  );
  assert.match(
    appSource,
    /if \(shouldUseSidebarDrawerViewport\(\)\) \{\s*sb\.classList\.toggle\("mob-open"\)/s,
  );
  assert.match(
    cssSource,
    /@media \(max-width: 1024px\) \{\s*\.sidebar \{/s,
  );
});
