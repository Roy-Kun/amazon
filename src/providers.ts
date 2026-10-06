export const DATA_PROVIDERS = ["sorftime", "sellersprite"] as const;
export type DataProvider = typeof DATA_PROVIDERS[number];

export function parseProvider(value: string | undefined): DataProvider {
  const normalized = (value ?? "sorftime").trim().toLocaleLowerCase("en-US");
  if (normalized === "sellersprite" || normalized === "seller-sprite" || normalized === "卖家精灵") {
    return "sellersprite";
  }
  if (normalized === "sorftime") return "sorftime";
  throw new Error(`不支持的数据工具：${value}。可选值：sorftime、sellersprite`);
}

export function providerName(provider: DataProvider): string {
  return provider === "sellersprite" ? "卖家精灵 SellerSprite" : "Sorftime";
}

export function providerDataLoaded(provider: DataProvider, text: string): boolean {
  if (provider === "sellersprite") {
    return /卖家精灵|SellerSprite|月销量|月销售额|评分数|FBA费|上架日期/i.test(text);
  }
  return /Listing月销量|ASIN月销量/i.test(text);
}
