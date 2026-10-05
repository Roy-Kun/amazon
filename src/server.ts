import { createServer } from "node:http";
import type { SelectorDatabase } from "./database.ts";
import type { HumanDecision } from "./domain.ts";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}

function body(req: any): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let value = "";
    req.on("data", (chunk: Buffer) => {
      value += chunk.toString("utf8");
      if (value.length > 1_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => resolveBody(value));
    req.on("error", reject);
  });
}

function page(categoryUrl: string, candidates: any[], decisions: HumanDecision[]): string {
  const decisionMap = new Map(decisions.map((decision) => [decision.asin, decision]));
  const cards = candidates.filter((item) => item.rank != null).map((item) => {
    const s = item.snapshot;
    const human = decisionMap.get(s.asin);
    return `<article>
      <div class="rank">#${item.rank}</div>
      ${s.imageUrl ? `<img src="${escapeHtml(s.imageUrl)}" alt="">` : ""}
      <section>
        <h2><a href="${escapeHtml(s.productUrl)}" target="_blank" rel="noreferrer">${escapeHtml(s.title)}</a></h2>
        <p><b>${escapeHtml(s.asin)}</b> · $${escapeHtml(s.mainPrice)} · Listing月销量 ${escapeHtml(s.listingMonthlySales)} · 评论 ${escapeHtml(s.reviewCount)} · 总分 ${Number(item.score.finalTotal).toFixed(2)}</p>
        <p>需求 ${Number(item.score.demand).toFixed(1)} / 竞争 ${Number(item.score.competition).toFixed(1)} / 成本物流 ${Number(item.score.costLogistics).toFixed(1)} / 新品趋势 ${Number(item.score.newProductTrend).toFixed(1)} / 微创新 ${Number(item.score.innovation).toFixed(1)}</p>
        <p><b>痛点：</b>${escapeHtml(item.innovation.repeatedPainPoints.join("；") || "暂无")}</p>
        <p><b>结构：</b>${escapeHtml(item.innovation.structuralOpportunities.join("；") || "暂无")}</p>
        <p><b>配件：</b>${escapeHtml(item.innovation.accessoryOpportunities.join("；") || "暂无")}</p>
        <form method="post" action="/decision">
          <input type="hidden" name="asin" value="${escapeHtml(s.asin)}">
          <select name="value">
            ${["selected", "watch", "rejected"].map((value) => `<option value="${value}" ${human?.value === value ? "selected" : ""}>${value === "selected" ? "入选" : value === "watch" ? "观察" : "淘汰"}</option>`).join("")}
          </select>
          <input name="reason" placeholder="原因" value="${escapeHtml(human?.reason)}">
          <input name="notes" placeholder="备注" value="${escapeHtml(human?.notes)}">
          <button>保存</button>
        </form>
      </section>
    </article>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Amazon选品审核</title><style>
    body{font:14px/1.5 system-ui;margin:0;background:#f6f7f9;color:#1f2937}header{position:sticky;top:0;background:#111827;color:#fff;padding:14px 24px;z-index:2}main{max-width:1200px;margin:auto;padding:20px}article{display:grid;grid-template-columns:55px 150px 1fr;gap:16px;background:#fff;margin:12px 0;padding:16px;border-radius:12px;box-shadow:0 1px 4px #0001}.rank{font-size:22px;font-weight:700}img{width:150px;height:150px;object-fit:contain}h2{font-size:17px;margin:0}a{color:#2563eb}form{display:flex;gap:8px;flex-wrap:wrap}input{min-width:200px}input,select,button{padding:8px;border:1px solid #cbd5e1;border-radius:6px}button{background:#7c3aed;color:#fff;border:0}@media(max-width:700px){article{grid-template-columns:40px 1fr}article img{grid-column:2}}
  </style></head><body><header>Amazon + Sorftime 选品审核 · ${escapeHtml(categoryUrl)}</header><main>${cards || "尚无已排名候选，请先运行evaluate。"}</main></body></html>`;
}

export function startReviewServer(database: SelectorDatabase, categoryUrl: string, port = 4310): void {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/decision") {
        const form = new URLSearchParams(await body(req));
        const value = form.get("value");
        if (!form.get("asin") || !["selected", "watch", "rejected"].includes(value ?? "")) {
          res.writeHead(400).end("Invalid decision");
          return;
        }
        database.saveHumanDecision({
          asin: form.get("asin")!, value: value as HumanDecision["value"],
          reason: form.get("reason") ?? "", notes: form.get("notes") ?? "", decidedAt: new Date().toISOString()
        });
        res.writeHead(303, { location: "/" }).end();
        return;
      }
      if (req.method === "GET" && req.url === "/api/candidates") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(database.listEvaluations(categoryUrl)));
        return;
      }
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page(categoryUrl, database.listEvaluations(categoryUrl), database.listHumanDecisions()));
        return;
      }
      res.writeHead(404).end("Not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`审核页面：http://127.0.0.1:${port}`));
}
