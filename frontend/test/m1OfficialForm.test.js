import test from "node:test";
import assert from "node:assert/strict";

import { M1_FORM_TEMPLATE } from "../src/features/health-records/lib/m1OfficialFormTemplate.js";
import { isValidIndicatorCode } from "../../backend/src/config/m1Catalog.js";

/**
 * Structural guards for the official FHSIS M1 form template. These do not need a
 * browser: they prove the grouped/merged headers line up with the body columns
 * (the main failure mode of a hand-built multi-row-header form) and that every
 * data-bound row references a real KALUSAGAP M1 catalog indicator (no typos).
 */

// Walk a declarative header (cells with optional cs/rs) and return how many grid
// columns it spans — exactly how an HTML <thead> lays colSpan/rowSpan out.
const headerColumns = (headerRows) => {
  const occ = [];
  let maxCol = 0;
  for (let ri = 0; ri < headerRows.length; ri += 1) {
    occ[ri] = occ[ri] || [];
    let ci = 0;
    for (const cell of headerRows[ri]) {
      while (occ[ri][ci]) ci += 1;
      const cs = cell.cs || 1;
      const rs = cell.rs || 1;
      for (let dr = 0; dr < rs; dr += 1) {
        occ[ri + dr] = occ[ri + dr] || [];
        for (let dc = 0; dc < cs; dc += 1) occ[ri + dr][ci + dc] = true;
      }
      ci += cs;
      if (ci > maxCol) maxCol = ci;
    }
  }
  return maxCol;
};

const allTables = (blocks) => {
  const out = [];
  for (const b of blocks) {
    if (b.type === "table") out.push(b);
    if (b.type === "split") { out.push(...allTables(b.left || []), ...allTables(b.right || [])); }
  }
  return out;
};

test("every table's grouped header spans exactly its body column count", () => {
  for (const t of allTables(M1_FORM_TEMPLATE)) {
    const headerCols = headerColumns(t.headerRows);
    assert.equal(headerCols, t.cols.length,
      `header columns (${headerCols}) != body cols (${t.cols.length}) for a "${t.headerRows[0]?.[1]?.t || "?"}" table`);
    assert.equal(t.widths.length, t.cols.length, "widths length must equal body column count");
  }
});

test("every data-bound row references a real M1 catalog indicator", () => {
  for (const t of allTables(M1_FORM_TEMPLATE)) {
    for (const row of t.rows) {
      if (row.code) {
        assert.ok(isValidIndicatorCode(row.code), `unknown M1 indicator code in template: ${row.code}`);
      }
    }
  }
});

test("required official section titles are present and verbatim", () => {
  const sections = M1_FORM_TEMPLATE.filter((b) => b.type === "section").map((b) => b.label);
  const required = [
    "SECTION A. FAMILY PLANNING SERVICES FOR WOMEN OF REPRODUCTIVE AGE",
    "SECTION B. MATERNAL CARE AND SERVICES",
    "SECTION C. CHILD CARE AND SERVICES",
    "SECTION D. ORAL HEALTH CARE SERVICES",
    "SECTION E. NON-COMMUNICABLE DISEASES",
  ];
  for (const title of required) assert.ok(sections.includes(title), `missing section title: ${title}`);
});

test("Family Planning matrix keeps 6 measure groups over age+TOTAL columns", () => {
  const fp = allTables(M1_FORM_TEMPLATE).find((t) =>
    t.headerRows.some((hr) => hr.some((c) => /Current Users \(Beginning/.test(c.t || ""))));
  assert.ok(fp, "FP matrix table not found");
  // 6 measure groups, each spanning 4 columns (10-14/15-19/20-49/TOTAL) + the method label
  assert.equal(fp.cols.length, 25);
  assert.deepEqual(fp.headerRows[1].slice(0, 4).map((c) => c.t), ["10-14", "15-19", "20-49", "TOTAL"]);
});
