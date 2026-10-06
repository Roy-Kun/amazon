import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import ExcelJS from "exceljs";
import type { EvaluatedCandidate } from "./domain.ts";
import { resolveProjectPath } from "./paths.ts";

type ImageExtension = "jpeg" | "png" | "gif";

interface DownloadedImage {
  buffer: Buffer;
  extension: ImageExtension;
}

export interface ReportOptions {
  outputDir?: string;
  embedImages?: boolean;
  imageFetcher?: (url: string) => Promise<DownloadedImage | null>;
}

export interface ReportResult {
  xlsx: string;
  embeddedImages: number;
  imageFailures: number;
}

interface ReportColumn {
  header: string;
  width: number;
  value: (candidate: EvaluatedCandidate) => unknown;
  numberFormat?: string;
  wrap?: boolean;
}

const decisionName = { pass: "通过", reject: "淘汰", review: "人工复核" } as const;

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, "-").replace(/^-|-$/g, "") || "category";
}

function joinList(values: string[]): string | null {
  const text = values.filter(Boolean).join("；");
  return text || null;
}

function monthlyRevenue(candidate: EvaluatedCandidate): number | null {
  const price = candidate.snapshot.effectivePrice ?? candidate.snapshot.mainPrice;
  const sales = candidate.snapshot.listingMonthlySales;
  return price == null || sales == null ? null : price * sales;
}

function fbaRate(candidate: EvaluatedCandidate): number | null {
  const price = candidate.snapshot.effectivePrice;
  const fee = candidate.snapshot.fbaFee;
  return price == null || price <= 0 || fee == null ? null : fee / price;
}

function volumetricMetric(candidate: EvaluatedCandidate): number | null {
  const dimensions = candidate.snapshot.dimensions;
  return dimensions ? dimensions.length * dimensions.width * dimensions.height / 366 : null;
}

function dimensionsText(candidate: EvaluatedCandidate): string | null {
  const dimensions = candidate.snapshot.dimensions;
  return dimensions ? `${dimensions.length} × ${dimensions.width} × ${dimensions.height}` : null;
}

function ruleDetails(candidate: EvaluatedCandidate): string | null {
  const text = candidate.decision.hits
    .filter((hit) => hit.outcome !== "pass")
    .map((hit) => `${hit.rule}：${hit.reason}`)
    .join("；");
  return text || null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const columns: ReportColumn[] = [
  { header: "排名", width: 8, value: (c) => c.rank, numberFormat: "0" },
  { header: "ASIN", width: 15, value: (c) => c.snapshot.asin },
  { header: "父ASIN", width: 15, value: (c) => c.snapshot.parentAsin },
  { header: "产品名称", width: 42, value: (c) => c.snapshot.title, wrap: true },
  { header: "主图", width: 14, value: () => null },
  { header: "商品链接", width: 13, value: () => "打开商品" },
  { header: "类目", width: 18, value: (c) => c.snapshot.category },
  { header: "数据源", width: 12, value: (c) => c.snapshot.dataProvider ?? null },
  { header: "来源页码", width: 10, value: (c) => c.snapshot.page, numberFormat: "0" },
  { header: "品牌", width: 18, value: (c) => c.snapshot.brand ?? null },
  { header: "卖家", width: 22, value: (c) => c.snapshot.seller ?? null },
  { header: "配送方式", width: 11, value: (c) => c.snapshot.fulfillment },
  { header: "主售价(USD)", width: 14, value: (c) => c.snapshot.mainPrice, numberFormat: "$#,##0.00" },
  { header: "优惠后价(USD)", width: 16, value: (c) => c.snapshot.effectivePrice, numberFormat: "$#,##0.00" },
  { header: "Listing月销量", width: 15, value: (c) => c.snapshot.listingMonthlySales, numberFormat: "#,##0" },
  { header: "ASIN月销量", width: 14, value: (c) => c.snapshot.asinMonthlySales, numberFormat: "#,##0" },
  { header: "预估月销售额(USD)", width: 19, value: monthlyRevenue, numberFormat: "$#,##0" },
  { header: "评论数", width: 11, value: (c) => c.snapshot.reviewCount, numberFormat: "#,##0" },
  { header: "评分", width: 9, value: (c) => c.snapshot.rating, numberFormat: "0.0" },
  { header: "类目BSR", width: 12, value: (c) => c.snapshot.categoryRank, numberFormat: "#,##0" },
  { header: "小类排名", width: 12, value: (c) => c.snapshot.subcategoryRank, numberFormat: "#,##0" },
  { header: "卖家数", width: 10, value: (c) => c.snapshot.sellerCount, numberFormat: "#,##0" },
  { header: "子体数", width: 10, value: (c) => c.snapshot.variationCount, numberFormat: "#,##0" },
  { header: "上架日期", width: 13, value: (c) => parseDate(c.snapshot.listingDate), numberFormat: "yyyy-mm-dd" },
  { header: "FBA费用(USD)", width: 15, value: (c) => c.snapshot.fbaFee, numberFormat: "$#,##0.00" },
  { header: "FBA费率", width: 11, value: fbaRate, numberFormat: "0.0%" },
  { header: "尺寸(in)", width: 20, value: dimensionsText },
  { header: "体积指标", width: 11, value: volumetricMetric, numberFormat: "0.00" },
  { header: "重量(lb)", width: 11, value: (c) => c.snapshot.weightLb, numberFormat: "0.00" },
  { header: "广告位", width: 9, value: (c) => c.snapshot.sponsored ? "是" : "否" },
  { header: "Amazon自营", width: 12, value: (c) => c.snapshot.amazonIsSeller ? "是" : "否" },
  { header: "图片风险", width: 12, value: (c) => c.snapshot.imageRisk },
  { header: "规则结论", width: 12, value: (c) => decisionName[c.decision.status] },
  { header: "硬规则说明", width: 35, value: ruleDetails, wrap: true },
  { header: "风险标签", width: 24, value: (c) => joinList(c.flags), wrap: true },
  { header: "需求分", width: 10, value: (c) => c.score.demand, numberFormat: "0.00" },
  { header: "竞争分", width: 10, value: (c) => c.score.competition, numberFormat: "0.00" },
  { header: "成本物流分", width: 12, value: (c) => c.score.costLogistics, numberFormat: "0.00" },
  { header: "新品趋势分", width: 12, value: (c) => c.score.newProductTrend, numberFormat: "0.00" },
  { header: "微创新分", width: 11, value: (c) => c.score.innovation, numberFormat: "0.00" },
  { header: "品牌扣分", width: 11, value: (c) => c.score.brandPenalty, numberFormat: "0.00" },
  { header: "最终分", width: 10, value: (c) => c.score.finalTotal, numberFormat: "0.00" },
  { header: "差评痛点", width: 34, value: (c) => joinList(c.innovation.repeatedPainPoints), wrap: true },
  { header: "结构改进机会", width: 34, value: (c) => joinList(c.innovation.structuralOpportunities), wrap: true },
  { header: "配件组合机会", width: 34, value: (c) => joinList(c.innovation.accessoryOpportunities), wrap: true },
  { header: "抓取时间", width: 20, value: (c) => parseDate(c.snapshot.capturedAt), numberFormat: "yyyy-mm-dd hh:mm" },
  { header: "人工结论", width: 12, value: () => null },
  { header: "人工原因", width: 24, value: () => null, wrap: true },
  { header: "人工备注", width: 30, value: () => null, wrap: true }
];

async function defaultImageFetcher(url: string): Promise<DownloadedImage | null> {
  try {
    const parsedUrl = new URL(url);
    const allowedHost = parsedUrl.hostname === "m.media-amazon.com"
      || parsedUrl.hostname.endsWith(".media-amazon.com")
      || parsedUrl.hostname === "images-na.ssl-images-amazon.com"
      || parsedUrl.hostname.endsWith(".ssl-images-amazon.com");
    if (parsedUrl.protocol !== "https:" || !allowedHost) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > 5_000_000) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const extension: ImageExtension | null = contentType.includes("png")
      ? "png"
      : contentType.includes("gif")
        ? "gif"
        : contentType.includes("jpeg") || contentType.includes("jpg")
          ? "jpeg"
          : null;
    if (!extension) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= 5_000_000 ? { buffer, extension } : null;
  } catch {
    return null;
  }
}

async function fetchImages(
  candidates: EvaluatedCandidate[],
  fetcher: (url: string) => Promise<DownloadedImage | null>
): Promise<Array<DownloadedImage | null>> {
  const results = new Array<DownloadedImage | null>(candidates.length).fill(null);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      const url = candidates[index].snapshot.imageUrl;
      results[index] = url ? await fetcher(url) : null;
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, Math.max(1, candidates.length)) }, worker));
  return results;
}

function styleWorkbook(worksheet: ExcelJS.Worksheet, firstDataRow: number, lastDataRow: number): void {
  worksheet.views = [{ state: "frozen", xSplit: 4, ySplit: 5, showGridLines: false }];
  worksheet.properties.defaultRowHeight = 20;
  worksheet.getCell("A1").font = { name: "Arial", size: 16, bold: true, color: { argb: "FF1F2937" } };
  worksheet.getCell("A2").font = { name: "Arial", size: 10, italic: true, color: { argb: "FF64748B" } };
  worksheet.getCell("A3").font = { name: "Arial", size: 10, color: { argb: "FF475569" } };

  const header = worksheet.getRow(5);
  header.height = 32;
  header.eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FF17365D" } } };
  });

  if (lastDataRow >= firstDataRow) {
    worksheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: lastDataRow, column: columns.length } };
  }
  for (let rowNumber = firstDataRow; rowNumber <= lastDataRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = 64;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: "Arial", size: 10, color: { argb: "FF1F2937" } };
      cell.alignment = {
        vertical: "middle",
        horizontal: typeof cell.value === "number" ? "right" : "left",
        wrapText: columns[columnNumber - 1]?.wrap ?? false
      };
      if (rowNumber % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FA" } };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD9E2F3" } } };
    });
    const decisionCell = row.getCell(33);
    const decision = String(decisionCell.value ?? "");
    decisionCell.font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: decision === "通过" ? "FF166534" : decision === "淘汰" ? "FFB91C1C" : "FFB45309" }
    };
    for (const columnNumber of [47, 48, 49]) {
      row.getCell(columnNumber).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    }
  }
}

export async function writeReports(
  categoryName: string,
  categoryUrl: string,
  candidates: EvaluatedCandidate[],
  options: ReportOptions = {}
): Promise<ReportResult> {
  const outputDir = options.outputDir
    ? (isAbsolute(options.outputDir) ? options.outputDir : resolveProjectPath(options.outputDir))
    : resolveProjectPath("artifacts");
  mkdirSync(outputDir, { recursive: true });
  const xlsxPath = join(outputDir, `${safeFileName(categoryName)}-选品结果.xlsx`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon 自动选品";
  workbook.created = new Date();
  workbook.modified = new Date();
  const worksheet = workbook.addWorksheet("选品结果", { properties: { tabColor: { argb: "FF1F4E78" } } });
  worksheet.getCell("A1").value = `${categoryName} 亚马逊选品结果`;
  worksheet.getCell("A2").value = `生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}　候选商品：${candidates.length}`;
  worksheet.getCell("A3").value = { text: `类目来源：${categoryUrl}`, hyperlink: categoryUrl, tooltip: "打开Amazon类目页面" };
  worksheet.getRow(5).values = columns.map((column) => column.header);
  columns.forEach((column, index) => {
    const worksheetColumn = worksheet.getColumn(index + 1);
    worksheetColumn.width = column.width;
    if (column.numberFormat) worksheetColumn.numFmt = column.numberFormat;
  });

  candidates.forEach((candidate) => {
    const row = worksheet.addRow(columns.map((column) => column.value(candidate)));
    row.getCell(2).value = { text: candidate.snapshot.asin, hyperlink: candidate.snapshot.productUrl, tooltip: "打开Amazon商品页" };
    row.getCell(2).font = { name: "Arial", size: 10, color: { argb: "FF0563C1" }, underline: true };
    row.getCell(6).value = { text: "打开商品", hyperlink: candidate.snapshot.productUrl, tooltip: candidate.snapshot.title };
    row.getCell(6).font = { name: "Arial", size: 10, color: { argb: "FF0563C1" }, underline: true };
  });

  const firstDataRow = 6;
  const lastDataRow = 5 + candidates.length;
  styleWorkbook(worksheet, firstDataRow, lastDataRow);
  for (let rowNumber = firstDataRow; rowNumber <= lastDataRow; rowNumber += 1) {
    for (const columnNumber of [2, 6]) {
      worksheet.getCell(rowNumber, columnNumber).font = {
        name: "Arial",
        size: 10,
        color: { argb: "FF0563C1" },
        underline: true
      };
    }
  }
  if (lastDataRow >= firstDataRow) {
    worksheet.dataValidations.add(`AU${firstDataRow}:AU${lastDataRow}`, {
      type: "list",
      allowBlank: true,
      formulae: ['"入选,观察,淘汰"']
    });
  }

  const images = options.embedImages === false
    ? new Array<DownloadedImage | null>(candidates.length).fill(null)
    : await fetchImages(candidates, options.imageFetcher ?? defaultImageFetcher);
  let embeddedImages = 0;
  let imageFailures = 0;
  images.forEach((image, index) => {
    const rowNumber = firstDataRow + index;
    const imageUrl = candidates[index].snapshot.imageUrl;
    const cell = worksheet.getCell(rowNumber, 5);
    if (image) {
      const imageId = workbook.addImage({ buffer: image.buffer, extension: image.extension });
      worksheet.addImage(imageId, {
        tl: { col: 4.15, row: rowNumber - 0.92 },
        ext: { width: 68, height: 58 },
        hyperlinks: imageUrl ? { hyperlink: imageUrl, tooltip: "打开商品主图" } : undefined
      });
      embeddedImages += 1;
    } else if (imageUrl) {
      cell.value = { text: "查看主图", hyperlink: imageUrl, tooltip: "打开商品主图" };
      cell.font = { name: "Arial", size: 10, color: { argb: "FF0563C1" }, underline: true };
      imageFailures += 1;
    }
  });

  await workbook.xlsx.writeFile(xlsxPath);
  return { xlsx: xlsxPath, embeddedImages, imageFailures };
}
