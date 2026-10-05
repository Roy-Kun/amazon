import { WEIGHTS } from "./config.ts";
import { fbaFeeRatio, volumetricMetric } from "./rules.ts";
import { emptyInnovation } from "./domain.ts";
import type { CandidateSnapshot, EvaluatedCandidate, InnovationAnalysis, RuleDecision, ScoreBreakdown } from "./domain.ts";

type Metric = { candidate: CandidateSnapshot; value: number };

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function percentileMap(candidates: CandidateSnapshot[], getter: (candidate: CandidateSnapshot) => number | null, inverse = false): Map<string, number> {
  const values: Metric[] = candidates
    .map((candidate) => ({ candidate, value: getter(candidate) }))
    .filter((item): item is Metric => item.value != null && Number.isFinite(item.value));
  values.sort((a, b) => a.value - b.value);
  const result = new Map<string, number>();
  if (values.length === 1) {
    result.set(values[0].candidate.asin, 1);
    return result;
  }
  values.forEach((item, index) => {
    const percentile = values.length === 0 ? 0 : index / Math.max(1, values.length - 1);
    result.set(item.candidate.asin, inverse ? 1 - percentile : percentile);
  });
  return result;
}

function monthsSince(dateValue: string | null, now: Date): number | null {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime()) || date > now) return null;
  return Math.max(1 / 30, (now.getTime() - date.getTime()) / (30.4375 * 86_400_000));
}

function listingShare(candidate: CandidateSnapshot): number | null {
  if (candidate.listingMonthlySales == null || candidate.asinMonthlySales == null || candidate.asinMonthlySales <= 0) return null;
  return clamp(candidate.listingMonthlySales / candidate.asinMonthlySales);
}

function salesReviewRatio(candidate: CandidateSnapshot): number | null {
  if (candidate.listingMonthlySales == null || candidate.reviewCount == null) return null;
  return candidate.listingMonthlySales / Math.max(1, candidate.reviewCount);
}

function inverseRank(candidate: CandidateSnapshot): number | null {
  return candidate.subcategoryRank ?? candidate.categoryRank;
}

function preliminaryScoring(candidates: CandidateSnapshot[], now: Date): Map<string, ScoreBreakdown> {
  const salesReview = percentileMap(candidates, salesReviewRatio);
  const listingSales = percentileMap(candidates, (c) => c.listingMonthlySales);
  const asinSales = percentileMap(candidates, (c) => c.asinMonthlySales);
  const rank = percentileMap(candidates, inverseRank, true);
  const reviews = percentileMap(candidates, (c) => c.reviewCount, true);
  const sellers = percentileMap(candidates, (c) => c.sellerCount, true);
  const variations = percentileMap(candidates, (c) => c.variationCount, true);
  const share = percentileMap(candidates, listingShare);
  const fee = percentileMap(candidates, fbaFeeRatio, true);
  const velocity = percentileMap(candidates, (c) => {
    const months = monthsSince(c.listingDate, now);
    return months && c.listingMonthlySales != null ? c.listingMonthlySales / months : null;
  });

  const result = new Map<string, ScoreBreakdown>();
  for (const candidate of candidates) {
    const demand =
      (salesReview.get(candidate.asin) ?? 0) * 12 +
      (listingSales.get(candidate.asin) ?? 0) * 8 +
      (asinSales.get(candidate.asin) ?? 0) * 5 +
      (rank.get(candidate.asin) ?? 0) * 5;
    const competition =
      (reviews.get(candidate.asin) ?? 0) * 10 +
      (sellers.get(candidate.asin) ?? 0) * 6 +
      (variations.get(candidate.asin) ?? 0) * 4 +
      (share.get(candidate.asin) ?? 0) * 5;

    const volume = volumetricMetric(candidate);
    const volumeHeadroom = volume == null ? 0 : clamp(1 - volume / 5.51);
    const weightHeadroom = candidate.weightLb == null ? 0 : clamp(1 - candidate.weightLb / 5.51156);
    const costLogistics = (fee.get(candidate.asin) ?? 0) * 10 + volumeHeadroom * 5 + weightHeadroom * 5;

    const ageMonths = monthsSince(candidate.listingDate, now);
    const ageDays = ageMonths == null ? null : ageMonths * 30.4375;
    const ageScore = ageDays == null ? 0 : ageDays <= 180 ? 5 : ageDays <= 365 ? 2.5 : 0;
    const ratingScore = candidate.rating == null
      ? 0
      : candidate.rating >= 3.8 && candidate.rating <= 4.5
        ? 5
        : (candidate.rating >= 3.5 && candidate.rating < 3.8) || (candidate.rating > 4.5 && candidate.rating <= 4.7)
          ? 2.5
          : 0;
    const newProductTrend = ageScore + (velocity.get(candidate.asin) ?? 0) * 5 + ratingScore;
    const preliminaryTotal = demand + competition + costLogistics + newProductTrend;
    const brandPenalty = candidate.strongBrand ? WEIGHTS.strongBrandPenalty : 0;
    result.set(candidate.asin, {
      demand,
      competition,
      costLogistics,
      newProductTrend,
      innovation: 0,
      brandPenalty,
      preliminaryTotal,
      finalTotal: preliminaryTotal + brandPenalty
    });
  }
  return result;
}

export function scoreCandidates(
  candidates: CandidateSnapshot[],
  decisions: Map<string, RuleDecision>,
  innovations: Map<string, InnovationAnalysis> = new Map(),
  now = new Date()
): EvaluatedCandidate[] {
  const passCandidates = candidates.filter((candidate) => decisions.get(candidate.asin)?.status === "pass");
  const scores = preliminaryScoring(passCandidates, now);
  return candidates.map((snapshot) => {
    const decision = decisions.get(snapshot.asin) ?? { status: "review", hits: [] };
    const innovation = innovations.get(snapshot.asin) ?? emptyInnovation();
    const base = scores.get(snapshot.asin) ?? {
      demand: 0,
      competition: 0,
      costLogistics: 0,
      newProductTrend: 0,
      innovation: 0,
      brandPenalty: snapshot.strongBrand ? WEIGHTS.strongBrandPenalty : 0,
      preliminaryTotal: 0,
      finalTotal: snapshot.strongBrand ? WEIGHTS.strongBrandPenalty : 0
    };
    const innovationScore = clamp(innovation.painPointScore, 0, 4)
      + clamp(innovation.structureScore, 0, 3)
      + clamp(innovation.accessoryScore, 0, 3);
    const score = {
      ...base,
      innovation: innovationScore,
      finalTotal: base.preliminaryTotal + innovationScore + base.brandPenalty
    };
    const flags = [
      snapshot.sponsored ? "sponsored" : null,
      snapshot.strongBrand ? "strong_brand_review" : null,
      snapshot.imageRisk === "suspected" ? "image_risk_review" : null
    ].filter((value): value is string => Boolean(value));
    return { snapshot, decision, score, innovation, rank: null, flags };
  });
}
