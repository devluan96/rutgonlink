const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { __testUtils } = require("../api/db");

test("short-link raw click dedupe window is tightened to five minutes", () => {
  assert.equal(__testUtils.CLICK_DEDUP_WINDOW_MS, 5 * 60 * 1000);
});

test("click writes have a single-RPC migration with duplicate protection", () => {
  const migrationPath = path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260824_add_record_link_click_rpc.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(sql, /FUNCTION public\.record_link_click/i);
  assert.match(sql, /UPDATE public\.links/i);
  assert.match(sql, /INSERT INTO public\.clicks/i);
  assert.match(sql, /clicked_at >= now\(\) - interval '5 minutes'/i);
});
