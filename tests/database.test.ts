import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SelectorDatabase } from "../src/database.ts";
import { candidate } from "./fixtures.ts";

test("persists snapshots, checkpoints and human decisions", () => {
  const directory = mkdtempSync(join(tmpdir(), "amazon-selector-"));
  const database = new SelectorDatabase(join(directory, "selector.sqlite"));
  try {
    const snapshot = candidate();
    database.saveSnapshots([snapshot]);
    assert.equal(database.listSnapshots(snapshot.categoryUrl).length, 1);
    database.saveJob({
      categoryUrl: snapshot.categoryUrl,
      category: snapshot.category,
      currentPage: 12,
      status: "paused",
      message: "captcha",
      updatedAt: snapshot.capturedAt
    });
    assert.equal(database.getJob(snapshot.categoryUrl)?.currentPage, 12);
    database.saveHumanDecision({
      asin: snapshot.asin,
      value: "watch",
      reason: "供应链待确认",
      notes: "",
      decidedAt: snapshot.capturedAt
    });
    assert.equal(database.listHumanDecisions()[0].value, "watch");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
