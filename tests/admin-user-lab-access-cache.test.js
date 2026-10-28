const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

test("admin lab access updates the persisted user cache after a successful patch", async () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  const functionStart = appJs.indexOf("async function adminSetLabAccess(");
  const functionEnd = appJs.indexOf("\nasync function adminSetRole(", functionStart);

  assert.notEqual(functionStart, -1, "adminSetLabAccess should exist");
  assert.notEqual(functionEnd, -1, "adminSetLabAccess should have a stable boundary");

  const functionSource = appJs.slice(functionStart, functionEnd);
  const cacheWrites = [];
  const context = {
    adminUsers: [
      {
        id: 7,
        email: "lab-user@example.com",
        role: "user",
        can_use_lab: false,
      },
    ],
    showConfirmDialog: async () => true,
    fetch: async () => ({
      ok: true,
      json: async () => ({ user: { can_use_lab: true } }),
    }),
    writePersistentStatsCache: (kind, payload) => {
      cacheWrites.push({ kind, payload: structuredClone(payload) });
    },
    renderAdminUsers: () => {},
    toast: () => {},
  };
  vm.runInNewContext(
    `${functionSource}\nthis.adminSetLabAccess = adminSetLabAccess;`,
    context,
  );

  const checkbox = {
    checked: true,
    dataset: { currentValue: "false" },
  };
  await context.adminSetLabAccess(7, checkbox);

  assert.deepEqual(cacheWrites, [
    {
      kind: "admin-users",
      payload: {
        users: [
          {
            id: 7,
            email: "lab-user@example.com",
            role: "user",
            can_use_lab: true,
          },
        ],
      },
    },
  ]);
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.dataset.currentValue, "true");
});

test("admin user list revalidates server data after hydrating persisted cache", () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  const functionStart = appJs.indexOf("async function loadAdminData(");
  const functionEnd = appJs.indexOf("\nfunction formatAdminDateTime(", functionStart);

  assert.notEqual(functionStart, -1, "loadAdminData should exist");
  assert.notEqual(functionEnd, -1, "loadAdminData should have a stable boundary");

  const functionSource = appJs.slice(functionStart, functionEnd);
  assert.match(
    functionSource,
    /const hydratedFromCache = hydrateAdminSectionFromPersistentCache\(section\);[\s\S]*?return section === "users" \|\| !hydratedFromCache;/,
  );
});
