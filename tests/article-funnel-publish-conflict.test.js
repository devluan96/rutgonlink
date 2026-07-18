const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("findArticleFunnelPublishConflict allows republishing the same draft lab slug", async () => {
  const result = await __testUtils.findArticleFunnelPublishConflict(
    {
      async listArticleFunnelLabsByPublishedSlug() {
        return [{ id: 22, published_route_slug: "demo-lab" }];
      },
      async getArticleFunnelBySlug() {
        return {
          id: 91,
          route_slug: "demo-lab",
        };
      },
    },
    "demo-lab",
    { draftLabId: 22 },
  );

  assert.equal(result, null);
});

test("findArticleFunnelPublishConflict blocks another lab that already published the same slug", async () => {
  const result = await __testUtils.findArticleFunnelPublishConflict(
    {
      async listArticleFunnelLabsByPublishedSlug() {
        return [{ id: 22, published_route_slug: "demo-lab" }];
      },
      async getArticleFunnelBySlug() {
        return {
          id: 91,
          route_slug: "demo-lab",
        };
      },
    },
    "demo-lab",
    { draftLabId: 35 },
  );

  assert.equal(result?.type, "lab");
  assert.equal(result?.lab?.id, 22);
  assert.equal(result?.slug, "demo-lab");
});

test("findArticleFunnelPublishConflict blocks legacy published funnels that have no matching draft lab", async () => {
  const result = await __testUtils.findArticleFunnelPublishConflict(
    {
      async listArticleFunnelLabsByPublishedSlug() {
        return [];
      },
      async getArticleFunnelBySlug() {
        return {
          id: 91,
          route_slug: "demo-lab",
        };
      },
    },
    "demo-lab",
    { draftLabId: 0 },
  );

  assert.equal(result?.type, "published");
  assert.equal(result?.articleFunnel?.id, 91);
  assert.equal(result?.slug, "demo-lab");
});
