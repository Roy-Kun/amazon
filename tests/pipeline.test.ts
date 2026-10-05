import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCategory } from "../src/pipeline.ts";
import type { InnovationAnalyzer } from "../src/pipeline.ts";
import { candidate } from "./fixtures.ts";

const analyzer: InnovationAnalyzer = {
  async screenRisk(item) {
    return { imageRisk: item.imageRisk, imageRiskReason: item.imageRiskReason };
  },
  async analyze() {
    return {
      repeatedPainPoints: ["hard to clean"], structuralOpportunities: ["removable panel"], accessoryOpportunities: ["brush bundle"],
      painPointScore: 4, structureScore: 3, accessoryScore: 3,
      imageRisk: "clear", imageRiskReason: null, source: "heuristic"
    };
  }
};

test("deduplicates parent ASIN and retains best child", async () => {
  const items = [
    candidate({ asin: "B000000001", parentAsin: "P000000001", listingMonthlySales: 160, asinMonthlySales: 500, reviewCount: 400 }),
    candidate({ asin: "B000000002", parentAsin: "P000000001", listingMonthlySales: 450, asinMonthlySales: 500, reviewCount: 100 }),
    candidate({ asin: "B000000003", parentAsin: "P000000003", listingMonthlySales: 300, asinMonthlySales: 300, reviewCount: 150 })
  ];
  const result = await evaluateCategory(items, analyzer, new Date("2026-10-05T00:00:00Z"));
  assert.equal(result.final.length, 2);
  assert.equal(result.final.filter((item) => item.snapshot.parentAsin === "P000000001").length, 1);
  assert.equal(result.final.find((item) => item.snapshot.parentAsin === "P000000001")?.snapshot.asin, "B000000002");
});

test("returns no more than 50 candidates per category", async () => {
  const items = Array.from({ length: 75 }, (_, index) => candidate({
    asin: `B${String(index).padStart(9, "0")}`,
    parentAsin: `P${String(index).padStart(9, "0")}`,
    listingMonthlySales: 150 + index,
    asinMonthlySales: 250 + index,
    reviewCount: 100 + index
  }));
  const result = await evaluateCategory(items, analyzer, new Date("2026-10-05T00:00:00Z"));
  assert.equal(result.final.length, 50);
  assert.deepEqual(result.final.map((item) => item.rank), Array.from({ length: 50 }, (_, index) => index + 1));
});
