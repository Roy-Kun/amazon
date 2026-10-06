import { existsSync } from "node:fs";
import { collectCategory, launchBrowserSession, BrowserEnrichingAnalyzer, setupProviderProfile } from "./browser.ts";
import { createInnovationAnalyzer } from "./ai.ts";
import { SelectorDatabase } from "./database.ts";
import { evaluateCategory } from "./pipeline.ts";
import { writeReports } from "./report.ts";
import { startReviewServer } from "./server.ts";
import { parseProvider, providerName } from "./providers.ts";
import { resolveProjectPath } from "./paths.ts";

const envPath = resolveProjectPath(".env");
if (existsSync(envPath)) {
  try { process.loadEnvFile(envPath); } catch { /* Environment variables can still be supplied externally. */ }
}

function argumentsMap(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    result.set(key, inline ?? values[index + 1] ?? "true");
    if (inline == null && values[index + 1] && !values[index + 1].startsWith("--")) index += 1;
  }
  return result;
}

function required(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value) throw new Error(`缺少 --${key}`);
  return value;
}

function help(): void {
  console.log(`
Amazon 前台插件自动选品（Sorftime / 卖家精灵）

  node src/cli.ts profile --provider sellersprite [--profile DIR]
  node src/cli.ts collect --provider sellersprite --url URL --category NAME [--max-pages 400] [--profile DIR] [--cdp-url URL]
  node src/cli.ts evaluate --provider sellersprite --url URL --category NAME [--with-browser] [--profile DIR] [--cdp-url URL]
  node src/cli.ts serve --provider sellersprite --url URL [--port 4310]

--provider: sorftime（默认）或 sellersprite（卖家精灵）。
profile: 自动启动或附着常驻Chrome，打开Amazon后立即返回，浏览器继续运行。
collect: 自动翻页、解析并断点保存。
evaluate: 执行规则、评分、AI分析并导出前50。--with-browser会抓取1–3星评论。
serve: 打开本地人工审核页面。
--cdp-url: 覆盖CHROME_CDP_URL；未运行时会用固定资料自动启动Chrome，任务结束不会关闭浏览器。
`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = argumentsMap(rest);
  const provider = parseProvider(args.get("provider") ?? process.env.DATA_PROVIDER);
  const profileDir = resolveProjectPath(args.get("profile")
    || (provider === "sellersprite" ? process.env.SELLERSPRITE_PROFILE_DIR : process.env.CHROME_PROFILE_DIR)
    || (provider === "sellersprite" ? "./data/automation-chrome" : "./data/chrome-profile"));
  const cdpUrl = args.get("cdp-url");
  if (!command || command === "help" || command === "--help") return help();
  if (command === "profile") return setupProviderProfile(profileDir, provider, cdpUrl);

  const database = new SelectorDatabase(
    resolveProjectPath(process.env.DATABASE_PATH || (provider === "sellersprite" ? "./data/sellersprite-selector.sqlite" : "./data/selector.sqlite"))
  );
  if (command === "collect") {
    await collectCategory({
      categoryUrl: required(args, "url"),
      category: required(args, "category"),
      maxPages: Number(args.get("max-pages") ?? 400),
      profileDir,
      cdpUrl,
      provider,
      database
    });
    database.close();
    return;
  }
  if (command === "evaluate") {
    const categoryUrl = required(args, "url");
    const category = required(args, "category");
    const snapshots = database.listSnapshots(categoryUrl);
    if (snapshots.length === 0) throw new Error("数据库中没有该类目的快照，请先运行collect。");
    let analyzer = createInnovationAnalyzer();
    let browserSession: Awaited<ReturnType<typeof launchBrowserSession>> | null = null;
    if (args.has("with-browser")) {
      browserSession = await launchBrowserSession(profileDir, cdpUrl);
      analyzer = new BrowserEnrichingAnalyzer(browserSession.context, analyzer);
    }
    try {
      const result = await evaluateCategory(snapshots, analyzer);
      database.saveEvaluations(categoryUrl, result.all);
      const reports = writeReports(`${category}-${provider}`, categoryUrl, result.final);
      console.log(`${providerName(provider)}完成：${result.final.length}个候选，${result.review.length}个待复核`);
      console.log(`JSON: ${reports.json}\nCSV: ${reports.csv}`);
    } finally {
      if (browserSession) await browserSession.close();
      database.close();
    }
    return;
  }
  if (command === "serve") {
    const categoryUrl = required(args, "url");
    startReviewServer(database, categoryUrl, Number(args.get("port") ?? process.env.PORT ?? 4310));
    return;
  }
  database.close();
  help();
}

const oneShotCommand = ["profile", "collect", "evaluate"].includes(process.argv[2] ?? "");

function finish(code: number): void {
  if (oneShotCommand) {
    // Playwright may retain an internal CDP transport handle after disconnecting.
    // All files/databases are closed before main resolves, so a one-shot CLI can exit
    // without terminating the detached long-lived Chrome process.
    setTimeout(() => process.exit(code), 10);
    return;
  }
  process.exitCode = code;
}

main().then(() => finish(0)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  finish(1);
});
