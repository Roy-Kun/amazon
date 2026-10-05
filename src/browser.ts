import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CRITICAL_FIELDS, RULES } from "./config.ts";
import { extractRawCards, parseCard } from "./parser.ts";
import type { CandidateSnapshot, InnovationAnalysis } from "./domain.ts";
import type { InnovationAnalyzer } from "./pipeline.ts";
import type { SelectorDatabase } from "./database.ts";

async function loadPlaywright(): Promise<any> {
  try {
    return await import("playwright");
  } catch {
    throw new Error("缺少Playwright。请先使用标准Node.js/npm运行 `npm install`，再重试浏览器命令。");
  }
}

export async function launchSorftimeContext(profileDir: string): Promise<any> {
  const { chromium } = await loadPlaywright();
  mkdirSync(resolve(profileDir), { recursive: true });
  return chromium.launchPersistentContext(resolve(profileDir), {
    channel: "chrome",
    headless: false,
    viewport: { width: 1600, height: 1000 },
    locale: "en-US"
  });
}

export async function setupSorftimeProfile(profileDir: string): Promise<void> {
  const context = await launchSorftimeContext(profileDir);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://www.amazon.com", { waitUntil: "domcontentloaded" });
  console.log("专用Chrome已打开。请安装并登录Sorftime、登录Amazon；完成后在终端按Ctrl+C关闭。");
  await new Promise<void>((resolvePromise) => {
    const finish = async () => {
      await context.close();
      resolvePromise();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function criticalMissing(candidate: CandidateSnapshot): boolean {
  return CRITICAL_FIELDS.some((field) => candidate[field] == null);
}

function mergeCandidate(existing: CandidateSnapshot | undefined, incoming: CandidateSnapshot): CandidateSnapshot {
  if (!existing) return incoming;
  const merged: any = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value != null && value !== "" && (!(Array.isArray(value)) || value.length > 0)) merged[key] = value;
  }
  merged.retryCount = Math.max(existing.retryCount, incoming.retryCount);
  return merged;
}

async function scrollForLazyContent(page: any): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolveScroll) => {
      let previous = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 750);
        const height = document.documentElement.scrollHeight;
        if (window.scrollY + window.innerHeight >= height || height === previous) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolveScroll();
        }
        previous = height;
      }, 200);
    });
  });
}

async function waitForSorftime(page: any, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')]
      .some((element) => /Listing月销量|ASIN月销量/i.test(element.textContent ?? "")),
    undefined,
    { timeout: timeoutMs }
  ).catch(() => undefined);
}

async function detectBlock(page: any): Promise<string | null> {
  const body = (await page.locator("body").innerText().catch(() => "")).toLocaleLowerCase("en-US");
  if (/captcha|robot check|enter the characters you see below|请输入您在图片中看到的字符/i.test(body)) {
    return "检测到Amazon登录/验证码/机器人检查，任务已安全暂停，需人工处理";
  }
  return null;
}

async function collectCurrentPage(
  page: any,
  category: string,
  categoryUrl: string,
  pageNumber: number
): Promise<CandidateSnapshot[]> {
  const merged = new Map<string, CandidateSnapshot>();
  for (let attempt = 0; attempt <= RULES.missingDataRetries; attempt += 1) {
    await page.locator('[data-component-type="s-search-result"][data-asin]').first().waitFor({ timeout: 20_000 });
    await scrollForLazyContent(page);
    await waitForSorftime(page);
    const cards = await extractRawCards(page);
    const capturedAt = new Date().toISOString();
    for (const raw of cards) {
      const parsed = parseCard(raw, { category, categoryUrl, page: pageNumber, retryCount: attempt, capturedAt });
      merged.set(parsed.asin, mergeCandidate(merged.get(parsed.asin), parsed));
    }
    if ([...merged.values()].every((candidate) => !criticalMissing(candidate))) break;
    if (attempt < RULES.missingDataRetries) {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }
  for (const candidate of merged.values()) {
    if (criticalMissing(candidate)) candidate.retryCount = RULES.missingDataRetries;
  }
  return [...merged.values()];
}

function resumeUrl(categoryUrl: string, pageNumber: number): string {
  if (pageNumber <= 1) return categoryUrl;
  const url = new URL(categoryUrl);
  url.searchParams.set("page", String(pageNumber));
  return url.href;
}

export async function collectCategory(options: {
  categoryUrl: string;
  category: string;
  maxPages?: number;
  profileDir: string;
  database: SelectorDatabase;
}): Promise<void> {
  const maxPages = Math.min(options.maxPages ?? RULES.maxPages, RULES.maxPages);
  const prior = options.database.getJob(options.categoryUrl);
  const startPage = prior && prior.status !== "completed" ? Math.max(1, prior.currentPage + 1) : 1;
  const context = await launchSorftimeContext(options.profileDir);
  const page = context.pages()[0] ?? await context.newPage();
  mkdirSync(resolve("artifacts"), { recursive: true });
  let lastCompletedPage = startPage - 1;
  try {
    await page.goto(resumeUrl(options.categoryUrl, startPage), { waitUntil: "domcontentloaded" });
    for (let pageNumber = startPage; pageNumber <= maxPages; pageNumber += 1) {
      const blocked = await detectBlock(page);
      if (blocked) {
        await page.screenshot({ path: resolve("artifacts", `blocked-page-${pageNumber}.png`), fullPage: true });
        options.database.saveJob({
          categoryUrl: options.categoryUrl, category: options.category, currentPage: pageNumber - 1,
          status: "paused", message: blocked, updatedAt: new Date().toISOString()
        });
        throw new Error(blocked);
      }
      options.database.saveJob({
        categoryUrl: options.categoryUrl, category: options.category, currentPage: pageNumber - 1,
        status: "running", message: "正在采集", updatedAt: new Date().toISOString()
      });
      const snapshots = await collectCurrentPage(page, options.category, options.categoryUrl, pageNumber);
      options.database.saveSnapshots(snapshots);
      lastCompletedPage = pageNumber;
      options.database.saveJob({
        categoryUrl: options.categoryUrl, category: options.category, currentPage: pageNumber,
        status: "running", message: `已保存${snapshots.length}个商品`, updatedAt: new Date().toISOString()
      });

      const next = page.locator("a.s-pagination-next:not(.s-pagination-disabled)").first();
      if (pageNumber >= maxPages || await next.count() === 0) {
        options.database.saveJob({
          categoryUrl: options.categoryUrl, category: options.category, currentPage: pageNumber,
          status: "completed", message: "采集完成", updatedAt: new Date().toISOString()
        });
        break;
      }
      const firstAsin = await page.locator('[data-component-type="s-search-result"][data-asin]').first().getAttribute("data-asin");
      await next.click();
      await page.waitForFunction(
        (priorAsin: string | null) => document.querySelector('[data-component-type="s-search-result"][data-asin]')?.getAttribute("data-asin") !== priorAsin,
        firstAsin,
        { timeout: 20_000 }
      );
      await page.waitForTimeout(1_000);
    }
  } catch (error) {
    const current = options.database.getJob(options.categoryUrl);
    if (current?.status !== "paused") {
      options.database.saveJob({
        categoryUrl: options.categoryUrl,
        category: options.category,
        currentPage: lastCompletedPage,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString()
      });
    }
    throw error;
  } finally {
    await context.close();
  }
}

async function collectCriticalReviews(context: any, asin: string): Promise<string[]> {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.amazon.com/product-reviews/${asin}/?filterByStar=critical`, { waitUntil: "domcontentloaded" });
    const blocked = await detectBlock(page);
    if (blocked) throw new Error(blocked);
    const reviews = page.locator('[data-hook="review-body"]');
    await reviews.first().waitFor({ timeout: 12_000 }).catch(() => undefined);
    const count = Math.min(await reviews.count(), 20);
    const values: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const value = (await reviews.nth(index).innerText()).trim();
      if (value) values.push(value);
    }
    return values;
  } finally {
    await page.close();
  }
}

async function enrichParentAsin(context: any, candidate: CandidateSnapshot): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(candidate.productUrl || `https://www.amazon.com/dp/${candidate.asin}`, { waitUntil: "domcontentloaded" });
    const blocked = await detectBlock(page);
    if (blocked) throw new Error(blocked);
    const parent = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const patterns = [
        /["']parentAsin["']\s*:\s*["']([A-Z0-9]{10})["']/i,
        /["']parent_asin["']\s*:\s*["']([A-Z0-9]{10})["']/i,
        /data-parent-asin=["']([A-Z0-9]{10})["']/i
      ];
      for (const pattern of patterns) {
        const value = html.match(pattern)?.[1];
        if (value) return value;
      }
      return null;
    });
    if (parent) candidate.parentAsin = parent;
  } finally {
    await page.close();
  }
}

export class BrowserEnrichingAnalyzer implements InnovationAnalyzer {
  private readonly context: any;
  private readonly delegate: InnovationAnalyzer;

  constructor(context: any, delegate: InnovationAnalyzer) {
    this.context = context;
    this.delegate = delegate;
  }

  async screenRisk(candidate: CandidateSnapshot): Promise<Pick<CandidateSnapshot, "imageRisk" | "imageRiskReason">> {
    await enrichParentAsin(this.context, candidate).catch(() => undefined);
    return this.delegate.screenRisk
      ? this.delegate.screenRisk(candidate)
      : { imageRisk: candidate.imageRisk, imageRiskReason: candidate.imageRiskReason };
  }

  async analyze(candidate: CandidateSnapshot): Promise<InnovationAnalysis> {
    candidate.lowStarReviews = await collectCriticalReviews(this.context, candidate.asin).catch(() => []);
    return this.delegate.analyze(candidate);
  }
}
