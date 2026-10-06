import { DEFAULT_STRONG_BRANDS } from "./config.ts";
import type { CandidateSnapshot, DimensionsInches } from "./domain.ts";
import type { DataProvider } from "./providers.ts";

export interface RawProductCard {
  asin: string;
  title: string;
  productUrl: string;
  imageUrl: string | null;
  text: string;
  sponsored: boolean;
}

function numberFrom(value: string | null | undefined): number | null {
  if (!value) return null;
  const clean = value.replace(/[$,\s]/g, "").toUpperCase();
  const match = clean.match(/^(-?\d+(?:\.\d+)?)([KMB])?\+?$/);
  if (!match) return null;
  const multiplier = match[2] === "K" ? 1_000 : match[2] === "M" ? 1_000_000 : match[2] === "B" ? 1_000_000_000 : 1;
  return Number(match[1]) * multiplier;
}

function first(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function labeledNumber(text: string, label: string): number | null {
  return numberFrom(first(text, new RegExp(`(?:${label})\\s*[:：]?\\s*#?\\s*([\\d,.]+(?:\\.\\d+)?[KMB]?\\+?)`, "i")));
}

function lineLabeledNumber(text: string, label: string): number | null {
  return numberFrom(first(text, new RegExp(`(?:^|[\\r\\n])\\s*(?:${label})\\s*[:：]?\\s*#?\\s*([\\d,.]+(?:\\.\\d+)?[KMB]?\\+?)`, "im")));
}

export function parseDimensions(text: string): DimensionsInches | null {
  const value = first(text, /(?:包装尺寸|商品尺寸|尺寸|package dimensions?|product dimensions?|dimensions?)\s*[:：]?\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i);
  const full = text.match(/(?:包装尺寸|商品尺寸|尺寸|package dimensions?|product dimensions?|dimensions?)\s*[:：]?\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i);
  if (!value || !full) return null;
  return { length: Number(full[1]), width: Number(full[2]), height: Number(full[3]) };
}

function parseDate(text: string): string | null {
  const raw = first(text, /(?:上架日期|上架时间|首次上架时间|date first available|listing date|launch date)\s*[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
  if (!raw) return null;
  const [year, month, day] = raw.split(/[-/]/).map(Number);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseRanks(text: string): number[] {
  return [...text.matchAll(/#\s*([\d,]+)\s+(?:in|位于)/gi)]
    .map((match) => numberFrom(match[1]))
    .filter((value): value is number => value != null);
}

function parsePrices(text: string): { mainPrice: number | null; effectivePrice: number | null } {
  const coupon = numberFrom(first(text, /(?:coupon price|优惠(?:后)?价|折后价)\s*\$?\s*([\d,.]+)/i));
  const labeledMain = numberFrom(first(text, /^(?:price|售价|价格)\s*[:：]?\s*\$\s*([\d,.]+)/im));
  const anyPrice = numberFrom(first(text, /\$\s*([\d,.]+)/));
  const mainPrice = labeledMain ?? anyPrice;
  return { mainPrice, effectivePrice: coupon ?? mainPrice };
}

export function parseCard(
  raw: RawProductCard,
  context: { category: string; categoryUrl: string; page: number; retryCount: number; capturedAt?: string; provider?: DataProvider }
): CandidateSnapshot {
  const provider = context.provider ?? "sorftime";
  const text = raw.text.replace(/\u00a0/g, " ");
  const prices = parsePrices(text);
  const ratingLine = text.match(/(?:评分(?:\s*[（(](?:评价数|评分数)[）)])?|rating)\s*[:：]?\s*([\d.]+)\s*[（(]([\d,.]+)[）)]/i);
  const nativeRating = text.match(/([\d.]+)\s+out of 5 stars/i);
  const nativeReviews = text.match(/out of 5 stars\s*([\d,.]+)/i);
  const seller = first(text, /(?:Buy\s*Box\s*(?:卖家|owner)|BuyBox卖家|卖家|seller)\s*[:：]?\s*([^\r\n]+)/i);
  const brand = first(text, /(?:品牌|brand)\s*[:：]?\s*([^\r\n]+)/i);
  const ranks = parseRanks(text);
  const sellerSpriteBsr = labeledNumber(text, "BSR(?:大类排名)?|大类排名");
  const sellerSpriteSubRank = labeledNumber(text, "小类排名|Subcategory rank");
  const fbaFee = numberFrom(first(text, /(?:FBA费用|FBA费|FBA fee)\s*[:：]?\s*\$?\s*([\d,.]+)/i));
  const weightLb = numberFrom(first(text, /(?:包装重量|商品重量|重量|package weight|item weight|weight)\s*[:：]?\s*([\d,.]+)\s*(?:lb|lbs|磅)/i));
  const parentAsin = first(text, /(?:父ASIN|parent ASIN)\s*[:：]?\s*([A-Z0-9]{10})/i) ?? raw.asin;
  const brandLower = brand?.toLocaleLowerCase("en-US") ?? "";
  const sellerSpriteMonthlySales = labeledNumber(text, "子体月销量|ASIN月销量|近30天销量")
    ?? lineLabeledNumber(text, "月销量|Monthly sales");
  const sellerSpriteParentSales = labeledNumber(text, "父体月销量|父ASIN月销量|Listing月销量|总月销量|Parent monthly sales");
  const listingMonthlySales = provider === "sellersprite"
    ? sellerSpriteMonthlySales
    : labeledNumber(text, "Listing月销量|Listing monthly sales");
  const asinMonthlySales = provider === "sellersprite"
    ? sellerSpriteParentSales ?? sellerSpriteMonthlySales
    : labeledNumber(text, "ASIN月销量|ASIN monthly sales");
  const sellerSpriteRating = labeledNumber(text, "评分|星级|Rating");
  const sellerSpriteReviewCount = labeledNumber(text, "评分数|评价数|Ratings|Review count");
  return {
    dataProvider: provider,
    asin: raw.asin,
    parentAsin,
    marketplace: "US",
    category: context.category,
    categoryUrl: context.categoryUrl,
    page: context.page,
    title: raw.title,
    productUrl: raw.productUrl,
    imageUrl: raw.imageUrl,
    attributesText: text,
    ...prices,
    listingMonthlySales,
    asinMonthlySales,
    reviewCount: numberFrom(ratingLine?.[2]) ?? sellerSpriteReviewCount ?? numberFrom(nativeReviews?.[1]),
    rating: numberFrom(ratingLine?.[1]) ?? sellerSpriteRating ?? numberFrom(nativeRating?.[1]),
    brand,
    seller,
    amazonIsSeller: /(?:^|\b)(amazon(?:\.com)?)(?:\b|$)/i.test(seller ?? ""),
    sellerCount: labeledNumber(text, "卖家数量|卖家数|seller count") ?? numberFrom(first(text, /(\d+)\s*卖家/i)),
    variationCount: labeledNumber(text, "子体数量|变体数|variation count|variations") ?? numberFrom(first(text, /(\d+)\s*(?:子体|变体)/i)),
    listingDate: parseDate(text),
    fbaFee,
    dimensions: parseDimensions(text),
    weightLb,
    categoryRank: sellerSpriteBsr ?? ranks[0] ?? null,
    subcategoryRank: sellerSpriteSubRank ?? ranks[1] ?? null,
    sponsored: raw.sponsored,
    fulfillment: /\bFBA\b/i.test(text) ? "FBA" : /\bFBM\b/i.test(text) ? "FBM" : "UNKNOWN",
    strongBrand: DEFAULT_STRONG_BRANDS.some((value) => brandLower === value || brandLower.includes(value)),
    imageRisk: "unknown",
    imageRiskReason: null,
    lowStarReviews: [],
    sourceText: text,
    retryCount: context.retryCount,
    capturedAt: context.capturedAt ?? new Date().toISOString()
  };
}

export async function extractRawCards(page: any): Promise<RawProductCard[]> {
  const cards = page.locator('[data-component-type="s-search-result"][data-asin]');
  const count = await cards.count();
  const results: RawProductCard[] = [];
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const asin = (await card.getAttribute("data-asin"))?.trim();
    if (!asin) continue;
    const titleLocator = card.locator("h2").first();
    const linkLocator = card.locator('h2 a[href*="/dp/"], a[href*="/dp/"]').first();
    const imageLocator = card.locator("img.s-image").first();
    const cardText = await card.innerText();
    const providerNodes = page.locator([
      `[data-asin="${asin}"]`,
      `[data-sellersprite-asin="${asin}"]`,
      `[data-seller-sprite-asin="${asin}"]`
    ].join(","));
    const providerTexts: string[] = [];
    const providerNodeCount = Math.min(await providerNodes.count(), 12);
    for (let providerIndex = 0; providerIndex < providerNodeCount; providerIndex += 1) {
      const value = (await providerNodes.nth(providerIndex).innerText().catch(() => "")).trim();
      if (value && value !== cardText && !providerTexts.includes(value)) providerTexts.push(value);
    }
    results.push({
      asin,
      title: (await titleLocator.innerText().catch(() => "")).trim(),
      productUrl: await linkLocator.getAttribute("href").then((value: string | null) => value ? new URL(value, "https://www.amazon.com").href : `https://www.amazon.com/dp/${asin}`),
      imageUrl: await imageLocator.getAttribute("src").catch(() => null),
      text: [cardText, ...providerTexts].join("\n"),
      sponsored: /\bSponsored\b|广告/i.test(cardText)
    });
  }
  return results;
}
