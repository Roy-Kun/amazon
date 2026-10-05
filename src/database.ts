import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CandidateSnapshot, EvaluatedCandidate, HumanDecision } from "./domain.ts";

export interface CollectionJob {
  categoryUrl: string;
  category: string;
  currentPage: number;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  message: string;
  updatedAt: string;
}

export class SelectorDatabase {
  private readonly db: DatabaseSync;

  constructor(path = process.env.DATABASE_PATH || "./data/selector.sqlite") {
    const absolute = resolve(path);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        category_url TEXT NOT NULL,
        asin TEXT NOT NULL,
        parent_asin TEXT NOT NULL,
        page INTEGER NOT NULL,
        payload TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (category_url, asin)
      );
      CREATE TABLE IF NOT EXISTS evaluations (
        category_url TEXT NOT NULL,
        asin TEXT NOT NULL,
        rank INTEGER,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        PRIMARY KEY (category_url, asin)
      );
      CREATE TABLE IF NOT EXISTS human_decisions (
        asin TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        reason TEXT NOT NULL,
        notes TEXT NOT NULL,
        decided_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collection_jobs (
        category_url TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        current_page INTEGER NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  saveSnapshots(snapshots: CandidateSnapshot[]): void {
    const statement = this.db.prepare(`
      INSERT INTO snapshots(category_url, asin, parent_asin, page, payload, captured_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(category_url, asin) DO UPDATE SET
        parent_asin=excluded.parent_asin,
        page=excluded.page,
        payload=excluded.payload,
        captured_at=excluded.captured_at
    `);
    this.db.exec("BEGIN");
    try {
      for (const snapshot of snapshots) {
        statement.run(
          snapshot.categoryUrl,
          snapshot.asin,
          snapshot.parentAsin,
          snapshot.page,
          JSON.stringify(snapshot),
          snapshot.capturedAt
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listSnapshots(categoryUrl: string): CandidateSnapshot[] {
    const rows = this.db.prepare("SELECT payload FROM snapshots WHERE category_url=? ORDER BY page, asin").all(categoryUrl) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload));
  }

  saveEvaluations(categoryUrl: string, candidates: EvaluatedCandidate[]): void {
    const statement = this.db.prepare(`
      INSERT INTO evaluations(category_url, asin, rank, status, payload, evaluated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(category_url, asin) DO UPDATE SET
        rank=excluded.rank,
        status=excluded.status,
        payload=excluded.payload,
        evaluated_at=excluded.evaluated_at
    `);
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      for (const candidate of candidates) {
        statement.run(
          categoryUrl,
          candidate.snapshot.asin,
          candidate.rank,
          candidate.decision.status,
          JSON.stringify(candidate),
          now
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listEvaluations(categoryUrl: string): EvaluatedCandidate[] {
    const rows = this.db.prepare(`
      SELECT payload FROM evaluations
      WHERE category_url=?
      ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END, rank, asin
    `).all(categoryUrl) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload));
  }

  saveHumanDecision(decision: HumanDecision): void {
    this.db.prepare(`
      INSERT INTO human_decisions(asin, value, reason, notes, decided_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(asin) DO UPDATE SET
        value=excluded.value,
        reason=excluded.reason,
        notes=excluded.notes,
        decided_at=excluded.decided_at
    `).run(decision.asin, decision.value, decision.reason, decision.notes, decision.decidedAt);
  }

  listHumanDecisions(): HumanDecision[] {
    return (this.db.prepare("SELECT * FROM human_decisions ORDER BY decided_at DESC").all() as any[]).map((row) => ({
      asin: row.asin,
      value: row.value,
      reason: row.reason,
      notes: row.notes,
      decidedAt: row.decided_at
    }));
  }

  getJob(categoryUrl: string): CollectionJob | null {
    const row = this.db.prepare("SELECT * FROM collection_jobs WHERE category_url=?").get(categoryUrl) as any;
    return row ? {
      categoryUrl: row.category_url,
      category: row.category,
      currentPage: row.current_page,
      status: row.status,
      message: row.message,
      updatedAt: row.updated_at
    } : null;
  }

  saveJob(job: CollectionJob): void {
    this.db.prepare(`
      INSERT INTO collection_jobs(category_url, category, current_page, status, message, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(category_url) DO UPDATE SET
        category=excluded.category,
        current_page=excluded.current_page,
        status=excluded.status,
        message=excluded.message,
        updated_at=excluded.updated_at
    `).run(job.categoryUrl, job.category, job.currentPage, job.status, job.message, job.updatedAt);
  }

  close(): void {
    this.db.close();
  }
}
