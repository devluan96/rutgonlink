const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("recordArticleFunnelStageClick skips preview launches without published slug", async () => {
  let called = false;
  const database = {
    async recordArticleFunnelClick() {
      called = true;
      return { counted: true };
    },
  };

  const result = await __testUtils.recordArticleFunnelStageClick({
    database,
    req: { headers: {} },
    tracking: null,
    stageKey: "3s",
  });

  assert.equal(called, false);
  assert.deepEqual(result, { counted: false, skipped: true });
});

test("recordArticleFunnelStageClick normalizes stage and forwards request context", async () => {
  const captured = [];
  const database = {
    async recordArticleFunnelClick(...args) {
      captured.push(args);
      return { counted: true, deduped: false };
    },
  };

  const result = await __testUtils.recordArticleFunnelStageClick({
    database,
    req: {
      headers: {
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
        "user-agent": "Mozilla/5.0 Demo",
        referer: "https://facebook.com/demo-post",
        "cf-ipcountry": "VN",
        "x-vercel-ip-country": "VN",
        "x-vercel-ip-country-region": "SG",
        "x-vercel-ip-city": "Ho Chi Minh City",
      },
      socket: { remoteAddress: "127.0.0.1" },
    },
    tracking: {
      routeSlug: "lab-aff-demo",
      articleFunnelId: 12,
    },
    stageKey: "5s",
  });

  assert.equal(result.counted, true);
  assert.equal(captured.length, 1);
  assert.equal(captured[0][0], "lab-aff-demo");
  assert.equal(captured[0][1], "20s");
  assert.equal(captured[0][2], "203.0.113.9");
  assert.equal(captured[0][3], "Mozilla/5.0 Demo");
  assert.equal(captured[0][4], "https://facebook.com/demo-post");
  assert.equal(captured[0][5].country_code, "VN");
});
