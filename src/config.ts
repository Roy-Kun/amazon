export const RULES = {
  minMainPrice: 35,
  maxMainPrice: 500,
  minListingMonthlySales: 150,
  maxReviewCount: 500,
  maxVolumetricMetric: 5.51,
  maxWeightLb: 5.51156,
  maxFbaFeeRatio: 0.25,
  maxPages: 400,
  missingDataRetries: 2,
  preliminaryPoolSize: 100,
  finalPoolSize: 50
} as const;

export const WEIGHTS = {
  demand: 30,
  competition: 25,
  costLogistics: 20,
  newProductTrend: 15,
  innovation: 10,
  strongBrandPenalty: -20
} as const;

export const EXCLUDED_FORM_TERMS = [
  "liquid", "fluid", "serum", "oil", "drops", "solution", "lotion",
  "paste", "cream", "ointment", "balm", "gel", "spray", "aerosol",
  "powder", "dust", "granule", "granules", "capsule", "capsules",
  "液体", "膏体", "膏状", "乳霜", "凝胶", "喷雾", "粉末", "粉剂",
  "颗粒", "胶囊"
] as const;

export const CHILDREN_TERMS = [
  "baby", "babies", "infant", "infants", "toddler", "toddlers", "kid",
  "kids", "child", "children", "youth", "teen", "teenager", "juvenile",
  "newborn", "nursery", "婴儿", "幼儿", "儿童", "孩子", "青少年"
] as const;

// Solid products shipped empty are not excluded merely because they hold water in use.
export const EMPTY_WHEN_SHIPPED_TERMS = [
  "water fountain", "water bottle", "water dispenser", "humidifier",
  "diffuser", "sprayer bottle", "empty bottle", "空瓶", "饮水机", "饮水器"
] as const;

export const DEFAULT_STRONG_BRANDS = [
  "amazon basics", "apple", "samsung", "nike", "adidas", "lego", "disney",
  "mattel", "fisher-price", "philips", "sony", "dyson", "kitchenaid"
] as const;

export const CRITICAL_FIELDS = [
  "mainPrice", "effectivePrice", "listingMonthlySales", "asinMonthlySales",
  "reviewCount", "seller", "fbaFee", "dimensions", "weightLb"
] as const;
