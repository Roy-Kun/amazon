import test from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../src/parser.ts";

test("parses Sorftime Chinese labels and coupon", () => {
  const parsed = parseCard({
    asin: "B012345678",
    title: "Solid pet product",
    productUrl: "https://www.amazon.com/dp/B012345678",
    imageUrl: "https://example.com/product.jpg",
    sponsored: true,
    text: `$59.99\nCoupon price $41.99\nListing月销量：761\nASIN月销量：3000+\n评分（评价数）：4.6 (19)\n品牌：FEELNEEDY\n卖家：FeelNeedy Direct\n2卖家 1子体\n上架时间：2026-09-10\nFBA费用：$8.69\n尺寸：10.59x9.45x7.72 inches\n重量：4.14 lb\n#2,948 in Pet Supplies\n#25 in Cat Fountains`
  }, { category: "Pet Supplies", categoryUrl: "https://example.com/category", page: 1, retryCount: 0 });
  assert.equal(parsed.mainPrice, 59.99);
  assert.equal(parsed.effectivePrice, 41.99);
  assert.equal(parsed.listingMonthlySales, 761);
  assert.equal(parsed.asinMonthlySales, 3000);
  assert.equal(parsed.reviewCount, 19);
  assert.equal(parsed.rating, 4.6);
  assert.equal(parsed.fbaFee, 8.69);
  assert.equal(parsed.weightLb, 4.14);
  assert.deepEqual(parsed.dimensions, { length: 10.59, width: 9.45, height: 7.72 });
  assert.equal(parsed.categoryRank, 2948);
  assert.equal(parsed.subcategoryRank, 25);
  assert.equal(parsed.sponsored, true);
});
