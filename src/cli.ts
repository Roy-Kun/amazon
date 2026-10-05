import { existsSync } from "node:fs";
import { collectCategory, launchSorftimeContext, BrowserEnrichingAnalyzer, setupSorftimeProfile } from "./browser.ts";
import { createInnovationAnalyzer } from "./ai.ts";
import { SelectorDatabase } from "./database.ts";
import { evaluateCategory } from "./pipeline.ts";
import { writeReports } from "./report.ts";
import { startReviewServer } from "./server.ts";

if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); } catch { /* Environment variables can still be supplied externally. */ }
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
Amazon + Sorftime 自动选品

  node src/cli.ts profile [--profile DIR]
  node src/cli.ts collect --url URL --category NAME [--max-pages 400] [--profile DIR]
  node src/cli.ts evaluate --url URL --category NAME [--with-browser] [--profile DIR]
  node src/cli.ts serve --url URL [--port 4310]

profile: 打开专用Chrome，手工安装/登录Sorftime和Amazon。
collect: 自动翻页、解析并断点保存。
evaluate: 执行规则、评分、AI分析并导出前50。--with-browser会抓取1–3星评论。
serve: 打开本地人工审核页面。
`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = argumentsMap(rest);
  const profileDir = args.get("profile") || process.env.CHROME_PROFILE_DIR || "./data/chrome-profile";
  if (!command || command === "help" || command === "--help") return help();
  if (command === "profile") return setupSorftimeProfile(profileDir);

  const database = new SelectorDatabase();
  if (command === "collect") {
    await collectCategory({
      categoryUrl: required(args, "url"),
      category: required(args, "category"),
      maxPages: Number(args.get("max-pages") ?? 400),
      profileDir,
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
    let context: any = null;
    if (args.has("with-browser")) {
      context = await launchSorftimeContext(profileDir);
      analyzer = new BrowserEnrichingAnalyzer(context, analyzer);
    }
    try {
      const result = await evaluateCategory(snapshots, analyzer);
      database.saveEvaluations(categoryUrl, result.all);
      const reports = writeReports(category, categoryUrl, result.final);
      console.log(`完成：${result.final.length}个候选，${result.review.length}个待复核`);
      console.log(`JSON: ${reports.json}\nCSV: ${reports.csv}`);
    } finally {
      if (context) await context.close();
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
