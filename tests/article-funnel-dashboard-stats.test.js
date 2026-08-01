const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/db");

test("buildArticleFunnelClickStats keeps unique windows scoped per lab and day", () => {
  const stats = __testUtils.buildArticleFunnelClickStats(
    [
      {
        article_funnel_id: 11,
        route_slug: "lab-a",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-08T15:00:00.000Z",
      },
      {
        article_funnel_id: 11,
        route_slug: "lab-a",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-09T01:00:00.000Z",
      },
      {
        article_funnel_id: 12,
        route_slug: "lab-b",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-09T01:05:00.000Z",
      },
      {
        article_funnel_id: 11,
        route_slug: "lab-a",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-09T01:10:00.000Z",
      },
      {
        article_funnel_id: 11,
        route_slug: "lab-a",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-09T02:00:01.000Z",
      },
    ],
    new Date("2026-07-09T03:00:00.000Z"),
  );

  assert.deepEqual(stats, {
    totalClicks: 5,
    uniqueClicks: 4,
    clicksToday: 4,
    uniqueClicksToday: 3,
  });
});

test("buildArticleFunnelClickStats keeps different stages separate while deduping repeats inside one stage window", () => {
  const stats = __testUtils.buildArticleFunnelClickStats(
    [
      {
        article_funnel_id: 21,
        route_slug: "lab-stage-hop",
        stage_key: "3s",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-09T01:00:00.000Z",
      },
      {
        article_funnel_id: 21,
        route_slug: "lab-stage-hop",
        stage_key: "20s",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-09T01:05:00.000Z",
      },
      {
        article_funnel_id: 21,
        route_slug: "lab-stage-hop",
        stage_key: "300s",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-09T01:10:00.000Z",
      },
      {
        article_funnel_id: 21,
        route_slug: "lab-stage-hop",
        stage_key: "300s",
        ip: "203.0.113.5",
        user_agent: "Mobile Safari",
        clicked_at: "2026-07-09T01:15:00.000Z",
      },
    ],
    new Date("2026-07-09T03:00:00.000Z"),
  );

  assert.deepEqual(stats, {
    totalClicks: 4,
    uniqueClicks: 3,
    clicksToday: 4,
    uniqueClicksToday: 3,
  });
});
