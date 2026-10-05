import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvaluatedCandidate } from "./domain.ts";

function csvCell(value: unknown): string {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function writeReports(categoryName: string, categoryUrl: string, candidates: EvaluatedCandidate[]): { json: string; csv: string } {
  mkdirSync(resolve("artifacts"), { recursive: true });
  const safeName = categoryName.replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, "-").replace(/^-|-$/g, "") || "category";
  const jsonPath = resolve("artifacts", `${safeName}-top50.json`);
  const csvPath = resolve("artifacts", `${safeName}-top50.csv`);
  writeFileSync(jsonPath, JSON.stringify({ categoryName, categoryUrl, generatedAt: new Date().toISOString(), candidates }, null, 2), "utf8");
  const headers = [
    "rank", "asin", "parentAsin", "title", "productUrl", "mainPrice", "effectivePrice",
    "listingMonthlySales", "asinMonthlySales", "reviewCount", "rating", "brand", "seller",
    "fbaFee", "weightLb", "categoryRank", "subcategoryRank", "sponsored", "decision",
    "demand", "competition", "costLogistics", "newProductTrend", "innovation", "brandPenalty",
    "finalTotal", "flags", "painPoints", "structuralOpportunities", "accessoryOpportunities"
  ];
  const rows = candidates.map((candidate) => {
    const s = candidate.snapshot;
    const score = candidate.score;
    const values = [
      candidate.rank, s.asin, s.parentAsin, s.title, s.productUrl, s.mainPrice, s.effectivePrice,
      s.listingMonthlySales, s.asinMonthlySales, s.reviewCount, s.rating, s.brand, s.seller,
      s.fbaFee, s.weightLb, s.categoryRank, s.subcategoryRank, s.sponsored, candidate.decision.status,
      score.demand, score.competition, score.costLogistics, score.newProductTrend, score.innovation,
      score.brandPenalty, score.finalTotal, candidate.flags, candidate.innovation.repeatedPainPoints,
      candidate.innovation.structuralOpportunities, candidate.innovation.accessoryOpportunities
    ];
    return values.map(csvCell).join(",");
  });
  writeFileSync(csvPath, [headers.map(csvCell).join(","), ...rows].join("\r\n"), "utf8");
  return { json: jsonPath, csv: csvPath };
}
