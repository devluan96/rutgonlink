const test = require('node:test');
const assert = require('node:assert/strict');

const { __testUtils } = require('../api/db');

test('finalizeClickAnalyticsSummaryPayload enriches platform metadata and percentages', () => {
  const summary = __testUtils.finalizeClickAnalyticsSummaryPayload({
    total_clicks: 10,
    unique_clicks: 4,
    timeline: [{ date: '2026-07-01', clicks: 10 }],
    unique_timeline: [{ date: '2026-07-01', clicks: 4 }],
    recent_buckets: [
      { bucket_started_at: '2026-07-01T10:00:00.000Z', clicks: 3 },
      { bucket_started_at: '2026-07-01T10:15:00.000Z', clicks: 7 },
    ],
    geo: {
      tracked_clicks: 8,
      unknown_clicks: 2,
      countries: [{ country_code: 'VN', country_name: 'Việt Nam', clicks: 8 }],
      top_countries: [
        {
          country_code: 'VN',
          country_name: 'Việt Nam',
          clicks: 8,
          city: 'Ho Chi Minh City',
          city_clicks: 5,
        },
      ],
      unique_tracked_clicks: 3,
      unique_unknown_clicks: 1,
      unique_countries: [
        { country_code: 'VN', country_name: 'Việt Nam', clicks: 3 },
      ],
      unique_top_countries: [
        {
          country_code: 'VN',
          country_name: 'Việt Nam',
          clicks: 3,
          city: 'Ho Chi Minh City',
          city_clicks: 2,
        },
      ],
    },
    platforms: {
      distribution: [
        { key: 'shopee', clicks: 6 },
        { key: 'generic', clicks: 4 },
      ],
      today_distribution: [
        { key: 'shopee', clicks: 6, clicks_today: 2 },
        { key: 'generic', clicks: 4, clicks_today: 1 },
      ],
      unique_distribution: [
        { key: 'shopee', clicks: 3 },
        { key: 'generic', clicks: 1 },
      ],
      unique_today_distribution: [
        { key: 'shopee', clicks: 3, clicks_today: 1 },
        { key: 'generic', clicks: 1, clicks_today: 1 },
      ],
    },
  });

  assert.equal(summary.platforms.distribution[0].label, 'Shopee');
  assert.equal(summary.platforms.distribution[0].color, '#ee4d2d');
  assert.equal(summary.platforms.distribution[0].percent, 60);
  assert.equal(summary.platforms.unique_distribution[0].unique, true);
  assert.equal(summary.platforms.unique_distribution[0].percent, 75);
  assert.equal(summary.platforms.top_platforms.length, 2);
  assert.equal(summary.platforms.today_distribution[0].clicks_today, 2);
  assert.equal(summary.geo.countries[0].country_name_en, 'Vietnam');
  assert.equal(summary.geo.unique_top_countries[0].country_name_en, 'Vietnam');
  assert.deepEqual(summary.recent_buckets, [
    { bucket_started_at: '2026-07-01T10:00:00.000Z', clicks: 3 },
    { bucket_started_at: '2026-07-01T10:15:00.000Z', clicks: 7 },
  ]);
});

test('finalizeClickAnalyticsSummaryPayload falls back unknown platform keys to generic metadata', () => {
  const summary = __testUtils.finalizeClickAnalyticsSummaryPayload({
    total_clicks: 5,
    unique_clicks: 2,
    platforms: {
      distribution: [{ key: 'mystery', clicks: 5 }],
      today_distribution: [{ key: 'mystery', clicks: 5, clicks_today: 5 }],
      unique_distribution: [{ key: 'mystery', clicks: 2 }],
      unique_today_distribution: [
        { key: 'mystery', clicks: 2, clicks_today: 2 },
      ],
    },
  });

  assert.equal(summary.platforms.distribution[0].key, 'generic');
  assert.equal(summary.platforms.distribution[0].label, 'Khác');
  assert.equal(summary.platforms.distribution[0].color, '#6366f1');
  assert.equal(summary.platforms.unique_distribution[0].percent, 100);
});
