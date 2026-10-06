import { mkdirSync, writeFileSync } from "node:fs";
import type { EvaluatedCandidate } from "./domain.ts";
import { resolveProjectPath } from "./paths.ts";

function csvCell(value: unknown): string {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function writeReports(categoryName: string, categoryUrl: string, candidates: EvaluatedCandidate[]): { json: string; csv: string } {
  mkdirSync(resolveProjectPath("artifacts"), { recursive: true });
  const safeName = categoryName.replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, "-").replace(/^-|-$/g, "") || "category";
  const jsonPath = resolveProjectPath(`artifacts/${safeName}-top50.json`);
  const csvPath = resolveProjectPath(`artifacts/${safeName}-top50.csv`);
  writeFileSync(jsonPath, JSON.stringify({ categoryName, categoryUrl, generatedAt: new Date().toISOString(), candidates }, null, 2), "utf8");
  const headers = [
    "rank", "dataProvider", "asin", "parentAsin", "title", "productUrl", "mainPrice", "effectivePrice",
    "listingMonthlySales", "asinMonthlySales", "reviewCount", "rating", "brand", "seller",
    "fbaFee", "weightLb", "categoryRank", "subcategoryRank", "sponsored", "decision",
    "demand", "competition", "costLogistics", "newProductTrend", "innovation", "brandPenalty",
    "finalTotal", "flags", "painPoints", "structuralOpportunities", "accessoryOpportunities"
  ];
  const rows = candidates.map((candidate) => {
    const s = candidate.snapshot;
    const score = candidate.score;
    const values = [
      candidate.rank, s.dataProvider, s.asin, s.parentAsin, s.title, s.productUrl, s.mainPrice, s.effectivePrice,
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
