export type DecisionStatus = "pass" | "reject" | "review";
export type HumanDecisionValue = "selected" | "watch" | "rejected";

export interface DimensionsInches {
  length: number;
  width: number;
  height: number;
}

export interface CandidateSnapshot {
  asin: string;
  parentAsin: string;
  marketplace: "US";
  category: string;
  categoryUrl: string;
  page: number;
  title: string;
  productUrl: string;
  imageUrl: string | null;
  attributesText: string;
  mainPrice: number | null;
  effectivePrice: number | null;
  listingMonthlySales: number | null;
  asinMonthlySales: number | null;
  reviewCount: number | null;
  rating: number | null;
  brand: string | null;
  seller: string | null;
  amazonIsSeller: boolean;
  sellerCount: number | null;
  variationCount: number | null;
  listingDate: string | null;
  fbaFee: number | null;
  dimensions: DimensionsInches | null;
  weightLb: number | null;
  categoryRank: number | null;
  subcategoryRank: number | null;
  sponsored: boolean;
  fulfillment: "FBA" | "FBM" | "UNKNOWN";
  strongBrand: boolean;
  imageRisk: "clear" | "suspected" | "unknown";
  imageRiskReason: string | null;
  lowStarReviews: string[];
  sourceText: string;
  retryCount: number;
  capturedAt: string;
}

export interface RuleHit {
  rule: string;
  outcome: "pass" | "reject" | "review";
  value: unknown;
  reason: string;
}

export interface RuleDecision {
  status: DecisionStatus;
  hits: RuleHit[];
}

export interface InnovationAnalysis {
  repeatedPainPoints: string[];
  structuralOpportunities: string[];
  accessoryOpportunities: string[];
  painPointScore: number;
  structureScore: number;
  accessoryScore: number;
  imageRisk: "clear" | "suspected" | "unknown";
  imageRiskReason: string | null;
  source: "openai" | "heuristic" | "not-run";
}

export interface ScoreBreakdown {
  demand: number;
  competition: number;
  costLogistics: number;
  newProductTrend: number;
  innovation: number;
  brandPenalty: number;
  preliminaryTotal: number;
  finalTotal: number;
}

export interface EvaluatedCandidate {
  snapshot: CandidateSnapshot;
  decision: RuleDecision;
  score: ScoreBreakdown;
  innovation: InnovationAnalysis;
  rank: number | null;
  flags: string[];
}

export interface HumanDecision {
  asin: string;
  value: HumanDecisionValue;
  reason: string;
  notes: string;
  decidedAt: string;
}

export function emptyInnovation(): InnovationAnalysis {
  return {
    repeatedPainPoints: [],
    structuralOpportunities: [],
    accessoryOpportunities: [],
    painPointScore: 0,
    structureScore: 0,
    accessoryScore: 0,
    imageRisk: "unknown",
    imageRiskReason: null,
    source: "not-run"
  };
}
