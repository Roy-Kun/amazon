import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHardRules } from "../src/rules.ts";
import { candidate } from "./fixtures.ts";

function rejectedRule(overrides: Parameters<typeof candidate>[0], rule: string): void {
  const result = evaluateHardRules(candidate(overrides));
  assert.equal(result.status, "reject");
  assert.ok(result.hits.some((hit) => hit.rule === rule && hit.outcome === "reject"));
}

test("boundary sales and reviews pass", () => {
  assert.equal(evaluateHardRules(candidate({ listingMonthlySales: 150, reviewCount: 500 })).status, "pass");
});

test("sales 149 and reviews 501 reject", () => {
  rejectedRule({ listingMonthlySales: 149 }, "listing_monthly_sales");
  rejectedRule({ reviewCount: 501 }, "review_count");
});

test("price endpoints pass and outside rejects", () => {
  assert.equal(evaluateHardRules(candidate({ mainPrice: 35 })).status, "pass");
  assert.equal(evaluateHardRules(candidate({ mainPrice: 500, effectivePrice: 500 })).status, "pass");
  rejectedRule({ mainPrice: 34.99 }, "main_price");
  rejectedRule({ mainPrice: 500.01, effectivePrice: 500.01 }, "main_price");
});

test("coupon price drives conservative FBA fee ratio", () => {
  assert.equal(evaluateHardRules(candidate({ mainPrice: 35, effectivePrice: 30, fbaFee: 7.5 })).status, "pass");
  rejectedRule({ mainPrice: 35, effectivePrice: 30, fbaFee: 7.51 }, "fba_fee_ratio");
});

test("strict volume and weight boundaries reject", () => {
  rejectedRule({ dimensions: { length: 5.51 * 366, width: 1, height: 1 } }, "volumetric_metric");
  rejectedRule({ weightLb: 5.51156 }, "weight_lb");
});

test("liquid and children products reject", () => {
  rejectedRule({ title: "Vitamin liquid drops for adults" }, "excluded_form");
  rejectedRule({ title: "Learning chair for kids" }, "children_product");
});

test("solid empty water fountain is not treated as a liquid", () => {
  const result = evaluateHardRules(candidate({ title: "Stainless steel cat water fountain", attributesText: "Ships empty" }));
  assert.equal(result.status, "pass");
  assert.ok(!result.hits.some((hit) => hit.rule === "excluded_form"));
});

test("solid powder-coated furniture is not treated as powder", () => {
  const result = evaluateHardRules(candidate({ title: "Powder-coated steel storage shelf" }));
  assert.equal(result.status, "pass");
});

test("image-only suspicion goes to review", () => {
  const result = evaluateHardRules(candidate({ imageRisk: "suspected", imageRiskReason: "May contain gel" }));
  assert.equal(result.status, "review");
});

test("Amazon retail rejects while sponsored remains eligible", () => {
  rejectedRule({ amazonIsSeller: true, seller: "Amazon.com" }, "amazon_retail");
  assert.equal(evaluateHardRules(candidate({ sponsored: true })).status, "pass");
});

test("missing critical data reviews only after two retries", () => {
  assert.equal(evaluateHardRules(candidate({ fbaFee: null, retryCount: 1 })).status, "pass");
  assert.equal(evaluateHardRules(candidate({ fbaFee: null, retryCount: 2 })).status, "review");
});
