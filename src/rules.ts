import {
  CHILDREN_TERMS,
  CRITICAL_FIELDS,
  EMPTY_WHEN_SHIPPED_TERMS,
  EXCLUDED_FORM_TERMS,
  RULES
} from "./config.ts";
import type { CandidateSnapshot, RuleDecision, RuleHit } from "./domain.ts";

function normalizedText(candidate: CandidateSnapshot): string {
  return [candidate.category, candidate.title, candidate.attributesText, candidate.sourceText]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
}

function containsTerm(text: string, terms: readonly string[]): string | null {
  return terms.find((term) => {
    if (/^[a-z0-9-]+$/i.test(term)) {
      return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text);
    }
    return text.includes(term.toLocaleLowerCase("zh-CN"));
  }) ?? null;
}

export function volumetricMetric(candidate: CandidateSnapshot): number | null {
  if (!candidate.dimensions) return null;
  const { length, width, height } = candidate.dimensions;
  if (![length, width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
  return (length * width * height) / 366;
}

export function fbaFeeRatio(candidate: CandidateSnapshot): number | null {
  if (candidate.fbaFee == null || candidate.effectivePrice == null || candidate.effectivePrice <= 0) return null;
  return candidate.fbaFee / candidate.effectivePrice;
}

function classifyTextRisk(candidate: CandidateSnapshot): RuleHit[] {
  const text = normalizedText(candidate);
  const hits: RuleHit[] = [];
  const formTerm = containsTerm(text, EXCLUDED_FORM_TERMS);
  const shippedEmptyTerm = containsTerm(text, EMPTY_WHEN_SHIPPED_TERMS);
  const solidFinishException = formTerm === "powder" && /\bpowder[- ]coated\b/i.test(text);
  const capsuleAccessoryException = formTerm?.startsWith("capsule") && /\bcapsule\s+(?:holder|organizer|storage|machine)\b/i.test(text);
  if (formTerm && !shippedEmptyTerm && !solidFinishException && !capsuleAccessoryException) {
    hits.push({
      rule: "excluded_form",
      outcome: "reject",
      value: formTerm,
      reason: `商品文字明确命中禁选形态：${formTerm}`
    });
  }
  const childTerm = containsTerm(text, CHILDREN_TERMS);
  if (childTerm) {
    hits.push({
      rule: "children_product",
      outcome: "reject",
      value: childTerm,
      reason: `商品文字或类目明确面向未成年人：${childTerm}`
    });
  }
  if (candidate.imageRisk === "suspected") {
    hits.push({
      rule: "image_risk",
      outcome: "review",
      value: candidate.imageRiskReason,
      reason: "只有图片疑似命中禁选类型，需要人工复核"
    });
  }
  return hits;
}

function check(
  rule: string,
  reject: boolean,
  value: unknown,
  rejectionReason: string,
  passReason: string
): RuleHit {
  return { rule, outcome: reject ? "reject" : "pass", value, reason: reject ? rejectionReason : passReason };
}

export function evaluateHardRules(candidate: CandidateSnapshot): RuleDecision {
  const hits: RuleHit[] = classifyTextRisk(candidate);

  const missing = CRITICAL_FIELDS.filter((field) => candidate[field] == null);
  if (missing.length > 0 && candidate.retryCount >= RULES.missingDataRetries) {
    hits.push({
      rule: "missing_critical_data",
      outcome: "review",
      value: missing,
      reason: `重试${RULES.missingDataRetries}次后仍缺少关键Sorftime字段`
    });
  }

  hits.push(check(
    "amazon_retail",
    candidate.amazonIsSeller,
    candidate.seller,
    "Amazon自营或Amazon占据主要Buy Box",
    "非Amazon自营"
  ));

  if (candidate.mainPrice != null) {
    hits.push(check(
      "main_price",
      candidate.mainPrice < RULES.minMainPrice || candidate.mainPrice > RULES.maxMainPrice,
      candidate.mainPrice,
      `页面主售价必须在$${RULES.minMainPrice}–$${RULES.maxMainPrice}`,
      "页面主售价达标"
    ));
  }

  if (candidate.listingMonthlySales != null) {
    hits.push(check(
      "listing_monthly_sales",
      candidate.listingMonthlySales < RULES.minListingMonthlySales,
      candidate.listingMonthlySales,
      `Listing月销量低于${RULES.minListingMonthlySales}`,
      "Listing月销量达标"
    ));
  }

  if (candidate.reviewCount != null) {
    hits.push(check(
      "review_count",
      candidate.reviewCount > RULES.maxReviewCount,
      candidate.reviewCount,
      `评论数超过${RULES.maxReviewCount}`,
      "评论数达标"
    ));
  }

  const volume = volumetricMetric(candidate);
  if (volume != null) {
    hits.push(check(
      "volumetric_metric",
      volume >= RULES.maxVolumetricMetric,
      volume,
      `长×宽×高÷366必须小于${RULES.maxVolumetricMetric}`,
      "包装体积指标达标"
    ));
  }

  if (candidate.weightLb != null) {
    hits.push(check(
      "weight_lb",
      candidate.weightLb >= RULES.maxWeightLb,
      candidate.weightLb,
      `包装重量必须小于${RULES.maxWeightLb}磅`,
      "包装重量达标"
    ));
  }

  const feeRatio = fbaFeeRatio(candidate);
  if (feeRatio != null) {
    hits.push(check(
      "fba_fee_ratio",
      feeRatio > RULES.maxFbaFeeRatio,
      feeRatio,
      `FBA费用占优惠后最低价超过${RULES.maxFbaFeeRatio * 100}%`,
      "FBA费率达标"
    ));
  }

  const status = hits.some((hit) => hit.outcome === "reject")
    ? "reject"
    : hits.some((hit) => hit.outcome === "review")
      ? "review"
      : "pass";
  return { status, hits };
}
