import test from "node:test";
import assert from "node:assert/strict";

test("browser module exports CDP-capable session launcher", async () => {
  const browser = await import("../src/browser.ts");
  assert.equal(typeof browser.launchSorftimeSession, "function");
});
