import { RULES } from "./config.ts";
import { evaluateHardRules } from "./rules.ts";
import { scoreCandidates } from "./scoring.ts";
import type { CandidateSnapshot, EvaluatedCandidate, InnovationAnalysis } from "./domain.ts";

export interface InnovationAnalyzer {
  analyze(candidate: CandidateSnapshot): Promise<InnovationAnalysis>;
  screenRisk?(candidate: CandidateSnapshot): Promise<Pick<CandidateSnapshot, "imageRisk" | "imageRiskReason">>;
}

function sortByPreliminary(a: EvaluatedCandidate, b: EvaluatedCandidate): number {
  return b.score.preliminaryTotal + b.score.brandPenalty - (a.score.preliminaryTotal + a.score.brandPenalty);
}

function dedupeParents(items: EvaluatedCandidate[]): EvaluatedCandidate[] {
  const best = new Map<string, EvaluatedCandidate>();
  for (const item of [...items].sort(sortByPreliminary)) {
    const key = item.snapshot.parentAsin || item.snapshot.asin;
    if (!best.has(key)) best.set(key, item);
  }
  return [...best.values()].sort(sortByPreliminary);
}

export async function evaluateCategory(
  snapshots: CandidateSnapshot[],
  analyzer: InnovationAnalyzer,
  now = new Date()
): Promise<{ all: EvaluatedCandidate[]; review: EvaluatedCandidate[]; final: EvaluatedCandidate[] }> {
  let workingSnapshots = snapshots.map((snapshot) => ({ ...snapshot }));
  const textAndMetricDecisions = new Map(workingSnapshots.map((snapshot) => [snapshot.asin, evaluateHardRules(snapshot)]));
  if (analyzer.screenRisk) {
    for (const snapshot of workingSnapshots) {
      if (textAndMetricDecisions.get(snapshot.asin)?.status !== "pass" || snapshot.imageRisk !== "unknown") continue;
      const risk = await analyzer.screenRisk(snapshot);
      snapshot.imageRisk = risk.imageRisk;
      snapshot.imageRiskReason = risk.imageRiskReason;
    }
  }
  const decisions = new Map(workingSnapshots.map((snapshot) => [snapshot.asin, evaluateHardRules(snapshot)]));
  const firstPass = scoreCandidates(workingSnapshots, decisions, new Map(), now);
  const eligible = firstPass.filter((item) => item.decision.status === "pass");
  const preliminary = dedupeParents(eligible).slice(0, RULES.preliminaryPoolSize);

  const innovations = new Map<string, InnovationAnalysis>();
  for (const item of preliminary) {
    innovations.set(item.snapshot.asin, await analyzer.analyze(item.snapshot));
  }

  const fullyScored = scoreCandidates(workingSnapshots, decisions, innovations, now);
  const final = dedupeParents(fullyScored.filter((item) => item.decision.status === "pass"))
    .sort((a, b) => b.score.finalTotal - a.score.finalTotal)
    .slice(0, RULES.finalPoolSize)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const rankMap = new Map(final.map((item) => [item.snapshot.asin, item.rank]));
  const all = fullyScored.map((item) => ({ ...item, rank: rankMap.get(item.snapshot.asin) ?? null }));
  const review = all.filter((item) => item.decision.status === "review" || item.snapshot.strongBrand);
  return { all, review, final };
}
