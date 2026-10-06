import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { CRITICAL_FIELDS, RULES } from "./config.ts";
import { extractRawCards, parseCard } from "./parser.ts";
import type { CandidateSnapshot, InnovationAnalysis } from "./domain.ts";
import type { InnovationAnalyzer } from "./pipeline.ts";
import type { SelectorDatabase } from "./database.ts";
import { providerName, type DataProvider } from "./providers.ts";
import { resolveProjectPath } from "./paths.ts";

async function loadPlaywright(): Promise<any> {
  try {
    return await import("playwright");
  } catch {
    throw new Error("缺少Playwright。请先使用标准Node.js/npm运行 `npm install`，再重试浏览器命令。");
  }
}

export interface BrowserSession {
  context: any;
  attached: boolean;
  close(): Promise<void>;
}

export type BrowserMode = "cdp" | "persistent";

export interface CdpLaunchOptions {
  cdpUrl: string;
  profileDir: string;
  executablePath: string;
  autoStart: boolean;
  timeoutMs?: number;
}

export interface CdpRuntimeDependencies {
  connect(url: string): Promise<any>;
  endpointReady(url: string): Promise<boolean>;
  executableExists(path: string): boolean;
  spawnChrome(executablePath: string, args: string[]): void;
  delay(ms: number): Promise<void>;
}

function parseBrowserMode(value: string | undefined): BrowserMode {
  const normalized = (value ?? "cdp").trim().toLocaleLowerCase("en-US");
  if (normalized === "cdp" || normalized === "persistent") return normalized;
  throw new Error(`不支持的BROWSER_MODE：${value}。可选值：cdp、persistent`);
}

export function defaultChromeExecutablePath(): string {
  const candidates = process.platform === "win32"
    ? [
        process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
        process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
    ?? (candidates.find((candidate): candidate is string => Boolean(candidate)) || "chrome");
}

export function chromeCdpArguments(cdpUrl: string, profileDir: string): string[] {
  const parsed = new URL(cdpUrl);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("自动启动Chrome只支持本机CDP地址（127.0.0.1或localhost）");
  }
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${resolveProjectPath(profileDir)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://www.amazon.com"
  ];
}

async function endpointReady(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/json/version", cdpUrl), { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function spawnChrome(executablePath: string, args: string[]): void {
  const child = spawn(executablePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.on("error", () => undefined);
  child.unref();
}

function attachedSession(browser: any): BrowserSession {
  const context = browser.contexts()[0];
  if (!context) throw new Error("CDP浏览器没有可用上下文");
  let disconnected = false;
  return {
    context,
    attached: true,
    // Browser.close() may terminate Chrome. Playwright's connection-level disconnect
    // releases the client socket while leaving the long-lived CDP browser running.
    close: async () => {
      if (disconnected) return;
      disconnected = true;
      if (typeof browser._disconnect === "function") await browser._disconnect();
      if (typeof browser._connection?.close === "function") await browser._connection.close();
    }
  };
}

export async function connectOrStartCdp(
  options: CdpLaunchOptions,
  dependencies: CdpRuntimeDependencies
): Promise<BrowserSession> {
  try {
    return attachedSession(await dependencies.connect(options.cdpUrl));
  } catch (initialError) {
    if (!options.autoStart) {
      throw new Error(`无法连接Chrome调试端口 ${options.cdpUrl}：${initialError instanceof Error ? initialError.message : initialError}`);
    }
  }

  if (!dependencies.executableExists(options.executablePath)) {
    throw new Error(`找不到Google Chrome：${options.executablePath}。请设置CHROME_EXECUTABLE_PATH。`);
  }
  const absoluteProfileDir = resolveProjectPath(options.profileDir);
  mkdirSync(absoluteProfileDir, { recursive: true });
  dependencies.spawnChrome(options.executablePath, chromeCdpArguments(options.cdpUrl, absoluteProfileDir));

  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (await dependencies.endpointReady(options.cdpUrl)) {
      try {
        return attachedSession(await dependencies.connect(options.cdpUrl));
      } catch (error) {
        lastError = error;
      }
    }
    await dependencies.delay(250);
  }
  throw new Error(
    `Chrome已启动但无法连接 ${options.cdpUrl}。资料目录可能正被未开启调试端口的Chrome占用；请关闭使用 ${absoluteProfileDir} 的Chrome后重试。`
    + (lastError instanceof Error ? ` 最后错误：${lastError.message}` : "")
  );
}

export async function launchBrowserSession(profileDir: string, cdpUrl?: string): Promise<BrowserSession> {
  const { chromium } = await loadPlaywright();
  const mode = parseBrowserMode(process.env.BROWSER_MODE);
  const effectiveCdpUrl = cdpUrl || process.env.CHROME_CDP_URL || "http://127.0.0.1:9222";
  if (mode === "cdp" || cdpUrl) {
    const executablePath = process.env.CHROME_EXECUTABLE_PATH || defaultChromeExecutablePath();
    return connectOrStartCdp({
      cdpUrl: effectiveCdpUrl,
      profileDir: resolveProjectPath(profileDir),
      executablePath,
      autoStart: true
    }, {
      connect: (url) => chromium.connectOverCDP(url),
      endpointReady,
      executableExists: existsSync,
      spawnChrome,
      delay: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
    });
  }
  const absoluteProfileDir = resolveProjectPath(profileDir);
  mkdirSync(absoluteProfileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(absoluteProfileDir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1600, height: 1000 },
    locale: "en-US"
  });
  return { context, attached: false, close: () => context.close() };
}

export async function launchSorftimeSession(profileDir: string, cdpUrl?: string): Promise<BrowserSession> {
  return launchBrowserSession(profileDir, cdpUrl);
}

export async function launchSorftimeContext(profileDir: string): Promise<any> {
  return (await launchSorftimeSession(profileDir)).context;
}

export async function setupProviderProfile(profileDir: string, provider: DataProvider, cdpUrl?: string): Promise<void> {
  const session = await launchBrowserSession(profileDir, cdpUrl);
  const { context } = session;
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://www.amazon.com", { waitUntil: "domcontentloaded" });
  if (session.attached) {
    console.log(`常驻Chrome已就绪：${providerName(provider)}将复用此窗口、插件和登录状态，任务结束不会关闭浏览器。`);
    await session.close();
    return;
  }
  console.log(`专用Chrome已打开。请安装并登录${providerName(provider)}、登录Amazon；完成后在终端按Ctrl+C关闭。`);
  await new Promise<void>((resolvePromise) => {
    const finish = async () => {
      await session.close();
      resolvePromise();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

export async function setupSorftimeProfile(profileDir: string): Promise<void> {
  return setupProviderProfile(profileDir, "sorftime");
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

async function waitForProviderData(page: any, provider: DataProvider, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    ({ providerValue }: { providerValue: DataProvider }) => [...document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')]
      .some((element) => providerValue === "sellersprite"
        ? /卖家精灵|SellerSprite|月销量|月销售额|评分数|FBA费|上架日期/i.test(element.textContent ?? "")
        : /Listing月销量|ASIN月销量/i.test(element.textContent ?? "")),
    { providerValue: provider },
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
  pageNumber: number,
  provider: DataProvider
): Promise<CandidateSnapshot[]> {
  const merged = new Map<string, CandidateSnapshot>();
  for (let attempt = 0; attempt <= RULES.missingDataRetries; attempt += 1) {
    await page.locator('[data-component-type="s-search-result"][data-asin]').first().waitFor({ timeout: 20_000 });
    await scrollForLazyContent(page);
    await waitForProviderData(page, provider);
    const cards = await extractRawCards(page);
    const capturedAt = new Date().toISOString();
    for (const raw of cards) {
      const parsed = parseCard(raw, { category, categoryUrl, page: pageNumber, retryCount: attempt, capturedAt, provider });
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
  const url = new URL(categoryUrl);
  if (pageNumber <= 1) url.searchParams.delete("page");
  else url.searchParams.set("page", String(pageNumber));
  return url.href;
}

function pageFromUrl(categoryUrl: string): number {
  try {
    const value = Number(new URL(categoryUrl).searchParams.get("page") ?? "1");
    return Number.isInteger(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

function sameCategoryUrl(actual: string, expected: string): boolean {
  try {
    const current = new URL(actual);
    const target = new URL(expected);
    return current.origin === target.origin
      && current.pathname === target.pathname
      && current.searchParams.get("i") === target.searchParams.get("i")
      && current.searchParams.get("rh") === target.searchParams.get("rh");
  } catch {
    return false;
  }
}

export async function collectCategory(options: {
  categoryUrl: string;
  category: string;
  maxPages?: number;
  profileDir: string;
  cdpUrl?: string;
  provider?: DataProvider;
  database: SelectorDatabase;
}): Promise<void> {
  const provider = options.provider ?? "sorftime";
  const maxPages = Math.min(options.maxPages ?? RULES.maxPages, RULES.maxPages);
  const prior = options.database.getJob(options.categoryUrl);
  const startPage = prior && prior.status !== "completed"
    ? Math.max(1, prior.currentPage + 1)
    : pageFromUrl(options.categoryUrl);
  const session = await launchBrowserSession(options.profileDir, options.cdpUrl);
  const { context } = session;
  const page = context.pages().find((item: any) => sameCategoryUrl(item.url(), options.categoryUrl))
    ?? context.pages()[0]
    ?? await context.newPage();
  mkdirSync(resolveProjectPath("artifacts"), { recursive: true });
  let lastCompletedPage = startPage - 1;
  try {
    if (startPage > 1 || !sameCategoryUrl(page.url(), options.categoryUrl)) {
      await page.goto(resumeUrl(options.categoryUrl, startPage), { waitUntil: "domcontentloaded" });
    }
    for (let pageNumber = startPage; pageNumber <= maxPages; pageNumber += 1) {
      const blocked = await detectBlock(page);
      if (blocked) {
        await page.screenshot({ path: resolveProjectPath(`artifacts/blocked-page-${pageNumber}.png`), fullPage: true });
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
      const snapshots = await collectCurrentPage(page, options.category, options.categoryUrl, pageNumber, provider);
      options.database.saveSnapshots(snapshots);
      lastCompletedPage = pageNumber;
      options.database.saveJob({
        categoryUrl: options.categoryUrl, category: options.category, currentPage: pageNumber,
        status: "running", message: `${providerName(provider)}已保存${snapshots.length}个商品`, updatedAt: new Date().toISOString()
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
    await session.close();
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
