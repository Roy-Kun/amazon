import test from "node:test";
import assert from "node:assert/strict";

test("Playwright package is installed and importable", async () => {
  const module = await import("playwright");
  assert.ok(module.chromium);
});
