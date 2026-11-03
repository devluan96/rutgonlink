const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { __testUtils } = require("../api/index");

function requestWithUserAgent(userAgent, extraHeaders = {}) {
  return {
    headers: {
      "user-agent": userAgent,
      ...extraHeaders,
    },
  };
}

test("published lab links return 404 for desktop browsers", () => {
  assert.equal(
    __testUtils.shouldBlockArticleFunnelDesktopRequest(
      requestWithUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
      ),
    ),
    true,
  );
  assert.equal(
    __testUtils.shouldBlockArticleFunnelDesktopRequest(
      requestWithUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
      ),
    ),
    true,
  );
});

test("published lab links remain available on phones and tablets", () => {
  const allowedUserAgents = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 15; SM-X910 Build/AP3A.240905.015.A2) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
  ];

  for (const userAgent of allowedUserAgents) {
    assert.equal(
      __testUtils.shouldBlockArticleFunnelDesktopRequest(
        requestWithUserAgent(userAgent),
      ),
      false,
      userAgent,
    );
  }
});

test("mobile client hints and social preview bots are not blocked", () => {
  assert.equal(
    __testUtils.shouldBlockArticleFunnelDesktopRequest(
      requestWithUserAgent("Mozilla/5.0", { "sec-ch-ua-mobile": "?1" }),
    ),
    false,
  );
  assert.equal(
    __testUtils.shouldBlockArticleFunnelDesktopRequest(
      requestWithUserAgent(
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      ),
    ),
    false,
  );
});

test("desktop 404 responder stops the route even when sendFile returns undefined", () => {
  const calls = [];
  const response = {
    set(name, value) {
      calls.push(["set", name, value]);
      return this;
    },
    status(code) {
      calls.push(["status", code]);
      return this;
    },
    sendFile(filePath) {
      calls.push(["sendFile", filePath]);
      return undefined;
    },
  };

  const handled = __testUtils.sendArticleFunnelDesktopNotFound(
    requestWithUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
    ),
    response,
  );

  assert.equal(handled, true);
  assert.deepEqual(calls.slice(0, 2), [
    ["set", "Cache-Control", "no-store"],
    ["status", 404],
  ]);
  assert.equal(calls[2][0], "sendFile");
  assert.match(calls[2][1], /public[\\/]lab-404\.html$/);
});

test("lab desktop 404 is neutral and has no call to action", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "public", "lab-404.html"),
    "utf8",
  );

  assert.match(html, />404</);
  assert.doesNotMatch(html, /Tạo link mới|link rút gọn|BocLink/i);
  assert.doesNotMatch(html, /<(?:a|button)\b/i);
});
