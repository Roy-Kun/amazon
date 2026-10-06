import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { emptyInnovation, type EvaluatedCandidate } from "../src/domain.ts";
import { writeReports } from "../src/report.ts";
import { candidate } from "./fixtures.ts";

function evaluatedCandidate(): EvaluatedCandidate {
  return {
    snapshot: candidate({
      asin: "B012345678",
      title: "Stainless Steel Pet Accessory",
      imageUrl: "https://images.example.com/product.jpg",
      mainPrice: 49.99,
      effectivePrice: 39.99,
      listingMonthlySales: 200,
      asinMonthlySales: 300
    }),
    decision: { status: "pass", hits: [] },
    score: {
      demand: 25,
      competition: 20,
      costLogistics: 18,
      newProductTrend: 10,
      innovation: 7,
      brandPenalty: 0,
      preliminaryTotal: 73,
      finalTotal: 80
    },
    innovation: emptyInnovation(),
    rank: 1,
    flags: ["sponsored"]
  };
}

test("writes a formatted Excel selection report with one product per row", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "amazon-report-"));
  try {
    const report = await writeReports("Pet Supplies-sellersprite", "https://www.amazon.com/s?i=pets", [evaluatedCandidate()], {
      outputDir,
      embedImages: false
    });
    assert.equal(existsSync(report.xlsx), true);
    assert.equal(report.embeddedImages, 0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(report.xlsx);
    const worksheet = workbook.getWorksheet("选品结果");
    assert.ok(worksheet);
    assert.equal(worksheet.getCell("A5").value, "排名");
    assert.equal(worksheet.getCell("B5").value, "ASIN");
    assert.equal(worksheet.getCell("D5").value, "产品名称");
    assert.equal(worksheet.getCell("E5").value, "主图");
    assert.equal((worksheet.getCell("B6").value as { text: string }).text, "B012345678");
    assert.equal(worksheet.getCell("D6").value, "Stainless Steel Pet Accessory");
    assert.equal((worksheet.getCell("E6").value as { text: string }).text, "查看主图");
    assert.equal(worksheet.getCell("O6").value, 200);
    assert.equal(worksheet.getCell("Q6").value, 7998);
    assert.equal(worksheet.getCell("AP6").value, 80);
    assert.equal(worksheet.getCell("AU6").value, null);
    assert.equal(worksheet.getCell("AU6").dataValidation.type, "list");
    assert.equal(worksheet.getCell("B6").font.underline, true);
    assert.equal(worksheet.rowCount, 6);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("embeds downloaded product images without changing the one-row product layout", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "amazon-report-image-"));
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7ZcAAAAASUVORK5CYII=", "base64");
    const report = await writeReports("Image Test", "https://www.amazon.com/s?k=test", [evaluatedCandidate()], {
      outputDir,
      imageFetcher: async () => ({ buffer: png, extension: "png" })
    });
    assert.equal(report.embeddedImages, 1);
    assert.equal(report.imageFailures, 0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(report.xlsx);
    const worksheet = workbook.getWorksheet("选品结果");
    assert.ok(worksheet);
    assert.equal(worksheet.getImages().length, 1);
    assert.equal(worksheet.rowCount, 6);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
