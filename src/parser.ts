import { DEFAULT_STRONG_BRANDS } from "./config.ts";
import type { CandidateSnapshot, DimensionsInches } from "./domain.ts";

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
  return numberFrom(first(text, new RegExp(`(?:${label})\\s*[:：]?\\s*([\\d,.]+(?:\\.\\d+)?[KMB]?\\+?)`, "i")));
}

export function parseDimensions(text: string): DimensionsInches | null {
  const value = first(text, /(?:尺寸|dimensions?)\s*[:：]?\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i);
  const full = text.match(/(?:尺寸|dimensions?)\s*[:：]?\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i);
  if (!value || !full) return null;
  return { length: Number(full[1]), width: Number(full[2]), height: Number(full[3]) };
}

function parseDate(text: string): string | null {
  const raw = first(text, /(?:上架时间|date first available|listing date)\s*[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
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
  const labeledMain = numberFrom(first(text, /^(?:price|售价)\s*[:：]?\s*\$\s*([\d,.]+)/im));
  const anyPrice = numberFrom(first(text, /\$\s*([\d,.]+)/));
  const mainPrice = labeledMain ?? anyPrice;
  return { mainPrice, effectivePrice: coupon ?? mainPrice };
}

export function parseCard(
  raw: RawProductCard,
  context: { category: string; categoryUrl: string; page: number; retryCount: number; capturedAt?: string }
): CandidateSnapshot {
  const text = raw.text.replace(/\u00a0/g, " ");
  const prices = parsePrices(text);
  const ratingLine = text.match(/(?:评分(?:\s*[（(]评价数[）)])?|rating)\s*[:：]?\s*([\d.]+)\s*[（(]([\d,.]+)[）)]/i);
  const nativeRating = text.match(/([\d.]+)\s+out of 5 stars/i);
  const nativeReviews = text.match(/out of 5 stars\s*([\d,.]+)/i);
  const seller = first(text, /(?:卖家|seller)\s*[:：]?\s*([^\r\n]+)/i);
  const brand = first(text, /(?:品牌|brand)\s*[:：]?\s*([^\r\n]+)/i);
  const ranks = parseRanks(text);
  const fbaFee = numberFrom(first(text, /(?:FBA费用|FBA fee)\s*[:：]?\s*\$?\s*([\d,.]+)/i));
  const weightLb = numberFrom(first(text, /(?:重量|weight)\s*[:：]?\s*([\d,.]+)\s*(?:lb|lbs|磅)/i));
  const parentAsin = first(text, /(?:父ASIN|parent ASIN)\s*[:：]?\s*([A-Z0-9]{10})/i) ?? raw.asin;
  const brandLower = brand?.toLocaleLowerCase("en-US") ?? "";
  return {
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
    listingMonthlySales: labeledNumber(text, "Listing月销量|Listing monthly sales"),
    asinMonthlySales: labeledNumber(text, "ASIN月销量|ASIN monthly sales"),
    reviewCount: numberFrom(ratingLine?.[2]) ?? numberFrom(nativeReviews?.[1]),
    rating: numberFrom(ratingLine?.[1]) ?? numberFrom(nativeRating?.[1]),
    brand,
    seller,
    amazonIsSeller: /(?:^|\b)(amazon(?:\.com)?)(?:\b|$)/i.test(seller ?? ""),
    sellerCount: labeledNumber(text, "卖家数量|seller count") ?? numberFrom(first(text, /(\d+)\s*卖家/i)),
    variationCount: labeledNumber(text, "子体数量|variation count") ?? numberFrom(first(text, /(\d+)\s*子体/i)),
    listingDate: parseDate(text),
    fbaFee,
    dimensions: parseDimensions(text),
    weightLb,
    categoryRank: ranks[0] ?? null,
    subcategoryRank: ranks[1] ?? null,
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
    results.push({
      asin,
      title: (await titleLocator.innerText().catch(() => "")).trim(),
      productUrl: await linkLocator.getAttribute("href").then((value: string | null) => value ? new URL(value, "https://www.amazon.com").href : `https://www.amazon.com/dp/${asin}`),
      imageUrl: await imageLocator.getAttribute("src").catch(() => null),
      text: await card.innerText(),
      sponsored: /\bSponsored\b|广告/i.test(await card.innerText())
    });
  }
  return results;
}
