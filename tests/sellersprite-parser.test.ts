import test from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../src/parser.ts";
import { parseProvider, providerDataLoaded } from "../src/providers.ts";

test("parses SellerSprite quick-view fields into the unchanged candidate model", () => {
  const parsed = parseCard({
    asin: "B0SELLER01",
    title: "Solid stainless steel pet accessory",
    productUrl: "https://www.amazon.com/dp/B0SELLER01",
    imageUrl: "https://example.com/product.jpg",
    sponsored: false,
    text: `价格：$59.99
卖家精灵 SellerSprite
月销量：761
父体月销量：3,000
评分：4.2
评分数：219
品牌：PETBRAND
BuyBox卖家：Pet Brand Direct
卖家数：2
变体数：3
上架日期：2026-04-01
FBA费：$8.69
包装尺寸：10.59 x 9.45 x 7.72 inches
包装重量：4.14 lb
BSR：#2,948
小类排名：#25
FBA`
  }, {
    category: "Pet Supplies",
    categoryUrl: "https://www.amazon.com/s?i=pets",
    page: 1,
    retryCount: 0,
    provider: "sellersprite"
  });

  assert.equal(parsed.dataProvider, "sellersprite");
  assert.equal(parsed.mainPrice, 59.99);
  assert.equal(parsed.listingMonthlySales, 761);
  assert.equal(parsed.asinMonthlySales, 3000);
  assert.equal(parsed.rating, 4.2);
  assert.equal(parsed.reviewCount, 219);
  assert.equal(parsed.sellerCount, 2);
  assert.equal(parsed.variationCount, 3);
  assert.equal(parsed.fbaFee, 8.69);
  assert.equal(parsed.categoryRank, 2948);
  assert.equal(parsed.subcategoryRank, 25);
  assert.equal(parsed.fulfillment, "FBA");
});

test("recognizes SellerSprite aliases and rendered data markers", () => {
  assert.equal(parseProvider("卖家精灵"), "sellersprite");
  assert.equal(parseProvider("seller-sprite"), "sellersprite");
  assert.equal(providerDataLoaded("sellersprite", "评分数 219 月销量 761"), true);
  assert.equal(providerDataLoaded("sorftime", "Listing月销量：761"), true);
});
