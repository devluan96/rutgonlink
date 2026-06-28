const test = require('node:test');
const assert = require('node:assert/strict');

const { __testUtils } = require('../api/db');

test('fetchPaginatedRows combines multiple Supabase-sized pages', async () => {
  const requestedRanges = [];
  const { data, error } = await __testUtils.fetchPaginatedRows(
    async (from, to) => {
      requestedRanges.push([from, to]);
      const size = to - from + 1;
      return {
        data: Array.from({ length: size }, (_, index) => ({
          id: from + index + 1,
        })),
        error: null,
      };
    },
    2500,
  );

  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.deepEqual(requestedRanges, [
    [0, 999],
    [1000, 1999],
    [2000, 2499],
  ]);
  assert.equal(data[0].id, 1);
  assert.equal(data.at(-1).id, 2500);
});

test('fetchPaginatedRows stops when a page returns fewer rows than requested', async () => {
  const { data, error } = await __testUtils.fetchPaginatedRows(
    async (from, to) => {
      if (from === 0) {
        return {
          data: Array.from({ length: to - from + 1 }, (_, index) => ({
            id: from + index + 1,
          })),
          error: null,
        };
      }
      return {
        data: [{ id: 1001 }, { id: 1002 }],
        error: null,
      };
    },
    5000,
  );

  assert.equal(error, null);
  assert.equal(data.length, 1002);
  assert.equal(data.at(-1).id, 1002);
});

test('fetchPaginatedRows returns partial rows alongside the first Supabase error', async () => {
  const expectedError = new Error('schema cache miss');
  const { data, error } = await __testUtils.fetchPaginatedRows(
    async (from, to) => {
      if (from === 0) {
        return {
          data: Array.from({ length: to - from + 1 }, (_, index) => ({
            id: from + index + 1,
          })),
          error: null,
        };
      }
      return {
        data: [],
        error: expectedError,
      };
    },
    2000,
  );

  assert.equal(error, expectedError);
  assert.equal(data.length, 1000);
  assert.equal(data[0].id, 1);
  assert.equal(data.at(-1).id, 1000);
});
