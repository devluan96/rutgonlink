const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/db");

test("PGRST204 only identifies the column named in the schema cache error", () => {
  const error = {
    code: "PGRST204",
    message:
      "Could not find the 'updated_at' column of 'users' in the schema cache",
  };

  assert.equal(__testUtils.isMissingColumnError(error, "updated_at"), true);
  assert.equal(__testUtils.isMissingColumnError(error, "can_use_lab"), false);
});

test("Postgres 42703 only identifies the column named in the query error", () => {
  const error = {
    code: "42703",
    message: 'column users.plan_expires_at does not exist',
  };

  assert.equal(__testUtils.isMissingColumnError(error, "plan_expires_at"), true);
  assert.equal(__testUtils.isMissingColumnError(error, "can_use_lab"), false);
});
