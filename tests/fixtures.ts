import type { CandidateSnapshot } from "../src/domain.ts";

export function candidate(overrides: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  const asin = overrides.asin ?? "B000000001";
  return {
    asin,
    parentAsin: overrides.parentAsin ?? asin,
    marketplace: "US",
    category: "Pet Supplies",
    categoryUrl: "https://www.amazon.com/s?i=pets",
    page: 1,
    title: "Solid stainless steel pet accessory",
    productUrl: `https://www.amazon.com/dp/${asin}`,
    imageUrl: null,
    attributesText: "solid stainless steel product",
    mainPrice: 35,
    effectivePrice: 35,
    listingMonthlySales: 150,
    asinMonthlySales: 300,
    reviewCount: 500,
    rating: 4.2,
    brand: "Generic Brand",
    seller: "Generic Seller",
    amazonIsSeller: false,
    sellerCount: 2,
    variationCount: 2,
    listingDate: "2026-06-01",
    fbaFee: 8.75,
    dimensions: { length: 10, width: 5, height: 3 },
    weightLb: 2,
    categoryRank: 1000,
    subcategoryRank: 20,
    sponsored: false,
    fulfillment: "FBA",
    strongBrand: false,
    imageRisk: "clear",
    imageRiskReason: null,
    lowStarReviews: [],
    sourceText: "",
    retryCount: 0,
    capturedAt: "2026-10-05T00:00:00.000Z",
    ...overrides
  };
}
