const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/db");

test("normalizeClickAnalyticsOptions keeps unlimited fallback requests unbounded", () => {
  const options = __testUtils.normalizeClickAnalyticsOptions(
    { days: 1, unlimited: true },
    2500,
  );

  assert.equal(options.days, 1);
  assert.equal(options.unlimited, true);
  assert.equal(options.limit, null);
});

test("fetchPaginatedRows reads all pages when limit is null", async () => {
  const pages = [
    [{ id: 1 }, { id: 2 }],
    [{ id: 3 }, { id: 4 }],
    [{ id: 5 }],
  ];
  let callCount = 0;

  const result = await __testUtils.fetchPaginatedRows(
    async (from, to) => {
      const pageIndex = callCount;
      callCount += 1;
      assert.equal(from, pageIndex * 2);
      assert.equal(to, pageIndex * 2 + 1);
      return { data: pages[pageIndex] || [], error: null };
    },
    null,
    2,
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.data, pages.flat());
  assert.equal(callCount, 3);
});
