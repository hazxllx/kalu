import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { M1_FORM_TEMPLATE } from "@/features/health-records/lib/m1OfficialFormTemplate";

/**
 * KALUSAGAP — FHSIS Monthly Form M1 — OFFICIAL-STYLE PRINT RENDERER.
 *
 * This is a DEDICATED print layer, fully separate from the Maternal Record
 * screen UI. It reproduces the official FHSIS M1 reporting-form structure:
 *
 *   - a compact bordered FORM HEADER (not a web title);
 *   - dark-navy full-width SECTION bars;
 *   - blue grouped/merged table headers with multi-row bands;
 *   - thin borders, compact rows, small professional type;
 *   - parent/child indicator indentation (1., 1a., b1. …);
 *   - per-section column schemes (age-group OR Male/Female OR the wide Family
 *     Planning matrix) — NOT one universal 7-column table.
 *
 * The form STRUCTURE/WORDING is a static template (`m1OfficialFormTemplate.js`).
 * The VALUES come from the live M1 aggregation API (`m1Api.monthly` → `byCode`).
 * Rows whose `code` maps to a real catalog indicator print its number (incl. 0);
 * rows with no backing data source are left blank per the form convention. No
 * value is hardcoded and no clinical information is invented.
 */

const CSS = `
.m1of {
  box-sizing: border-box;
  width: 100%;
  background: #ffffff;
  color: #10243B;
  font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
  font-size: 8px;
  line-height: 1.15;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.m1of * { box-sizing: border-box; }

/* ---------- form header (matches the official FHSIS M1 sheet) ---------- */
.m1of-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin: 0 0 6px; }
.m1of-head .seal { width: 128px; display: flex; gap: 6px; align-items: center; }
.m1of-head .seal span { display: inline-block; width: 30px; height: 30px; border-radius: 50%; border: 1px solid #9aa7b8; font-size: 5.5px; color: #6b7788; text-align: center; line-height: 30px; }
.m1of-head .fields { flex: 1 1 auto; }
.m1of-head .fields .row { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 8.5px; }
.m1of-head .fields .row .lab { color: #334A63; }
.m1of-head .fields .row .val { font-weight: 700; min-width: 70px; border-bottom: 1px solid #10243B; padding: 0 6px; }
.m1of-head .rhu { font-size: 22px; font-weight: 800; letter-spacing: 1px; color: #10243B; white-space: nowrap; }

/* ---------- section bar ---------- */
.m1of-sec { background: #0B3D7A; color: #fff; font-size: 9px; font-weight: 700; letter-spacing: .3px; padding: 3px 7px; margin: 7px 0 0; text-transform: uppercase; break-after: avoid; page-break-after: avoid; break-inside: avoid; }
.m1of-grp { background: #DCE6F2; color: #0B3D7A; font-size: 8.3px; font-weight: 700; padding: 2px 7px; margin: 0; border: 1px solid #7A8CA3; border-top: none; break-after: avoid; page-break-after: avoid; }

/* ---------- tables ---------- */
.m1of-t { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 2px; }
.m1of-t thead { display: table-header-group; }
.m1of-t th, .m1of-t td { border: 1px solid #7A8CA3; padding: 1.5px 4px; vertical-align: middle; overflow-wrap: anywhere; word-break: break-word; }
.m1of-t thead th { background: #C7D6E8; color: #0B3D7A; font-size: 7.3px; font-weight: 700; text-align: center; }
.m1of-t thead th.sub { background: #EAF0F7; color: #334A63; font-weight: 700; }
.m1of-t thead th.ind { text-align: left; }
.m1of-t td { font-size: 7.7px; }
.m1of-t td.code { text-align: center; font-family: "Courier New", monospace; font-size: 7.1px; color: #334A63; white-space: nowrap; }
.m1of-t td.ind { text-align: left; }
.m1of-t td.num { text-align: center; font-variant-numeric: tabular-nums; }
.m1of-t td.rem { text-align: left; color: #42566B; font-size: 7.3px; }
.m1of-t tr.grouprow td { background: #F1F5FA; font-weight: 700; }
.m1of-t tbody tr { break-inside: avoid; page-break-inside: avoid; }

/* parent/child indentation (clear hanging steps for 1a / a1 / b2 rows).
   Scoped to table cells so they outrank the td padding shorthand. */
.m1of-t td.ind { white-space: normal; }
.m1of-t td.m1of-i0 { padding-left: 4px; }
.m1of-t td.m1of-i1 { padding-left: 20px; }
.m1of-t td.m1of-i2 { padding-left: 38px; }
.m1of-t td.m1of-i3 { padding-left: 56px; }

/* keep a short table whole; let long ones flow with repeated header */
.m1of-keep { break-inside: avoid; page-break-inside: avoid; }

/* side-by-side */
.m1of-split { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; margin: 0 0 2px; }
.m1of-split > tbody > tr > td { vertical-align: top; padding: 0; }
.m1of-split > tbody > tr > td:first-child { padding-right: 3px; }

@page { size: A4 landscape; margin: 7mm 8mm; }
@media print { .m1of { width: 100% !important; } }
`;

// ---------------------------------------------------------------------------
// value resolution: a column descriptor `get` string → cell value from a record
//
// Numeric cells render the aggregated value, or 0 when there is no value yet
// (the official form prints 0, not blanks, in every applicable numeric cell).
// Pure category-heading rows (`heading: true`) keep their numeric cells empty,
// matching the merged heading rows on the sheet. Text columns stay blank.
// ---------------------------------------------------------------------------
const resolveCell = (get, row, rec) => {
  if (get === "label") return row.label;
  if (get === "remarks") return row.remarks || (rec ? rec.remarks || "" : "");
  // Numeric data columns:
  if (row.heading) return ""; // category label row → no numbers
  let v;
  if (get === "total") v = rec ? rec.total : undefined;
  else if (get.startsWith("age:")) v = rec && rec.byAge ? rec.byAge[get.slice(4)] : undefined;
  else if (get.startsWith("sex:")) v = rec && rec.bySex ? rec.bySex[get.slice(4)] : undefined;
  else if (get.startsWith("measure:")) {
    const [, key, band] = get.split(":");
    v = rec && rec.measures && rec.measures[key] ? rec.measures[key][band] : undefined;
  }
  return v === undefined || v === null ? 0 : v;
};

const cls = (get) => {
  if (get === "code") return "code";
  if (get === "label") return "ind";
  if (get === "remarks") return "rem";
  return "num";
};

// ---------------------------------------------------------------------------
// table renderer
// ---------------------------------------------------------------------------
function FormTable({ table, data }) {
  const { headerRows = [], cols = [], rows = [], widths } = table;
  const colCount = cols.length;
  const normWidths = widths && widths.length === colCount
    ? (() => { const s = widths.reduce((a, b) => a + b, 0); return widths.map((w) => `${((w / s) * 100).toFixed(3)}%`); })()
    : cols.map(() => `${(100 / colCount).toFixed(3)}%`);

  return (
    <table className={`m1of-t ${rows.length <= 14 ? "m1of-keep" : ""}`}>
      <colgroup>{normWidths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <thead>
        {headerRows.map((hr, ri) => (
          <tr key={ri}>
            {hr.map((c, ci) => (
              <th
                key={ci}
                colSpan={c.cs || 1}
                rowSpan={c.rs || 1}
                className={`${c.c === "ind" ? "ind" : ""} ${c.c === "sub" ? "sub" : ""}`.trim()}
              >
                {c.t}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {rows.map((row, ri) => {
          if (row.groupRow) {
            // a full-width labelled grouping row spanning indicator+data columns
            return (
              <tr className="grouprow" key={ri}>
                <td className="code">{row.code || ""}</td>
                <td className="ind" colSpan={colCount - 1}>{row.label}</td>
              </tr>
            );
          }
          const rec = row.code ? data[row.code] : null;
          return (
            <tr key={ri}>
              {cols.map((col, ci) => {
                const val = resolveCell(col.get, row, rec);
                const base = cls(col.get);
                const indentCls = col.get === "label" ? `m1of-i${row.indent || 0}` : "";
                return (
                  <td key={ci} className={`${base} ${indentCls}`.trim()}>
                    {col.get === "label" ? row.label : val}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Block({ block, data }) {
  if (block.type === "section") return <div className="m1of-sec">{block.label}</div>;
  if (block.type === "group") return <div className="m1of-grp">{block.label}</div>;
  if (block.type === "split") {
    return (
      <table className="m1of-split">
        <tbody>
          <tr>
            <td><Blocks blocks={block.left} data={data} /></td>
            <td><Blocks blocks={block.right} data={data} /></td>
          </tr>
        </tbody>
      </table>
    );
  }
  if (block.type === "table") return <FormTable table={block} data={data} />;
  return null;
}

function Blocks({ blocks = [], data }) {
  return blocks.map((b, i) => <Block key={i} block={b} data={data} />);
}

export default function M1OfficialForm({ data = {}, header = {}, template = M1_FORM_TEMPLATE }) {
  const h = header;
  return (
    <div className="m1of">
      <style>{CSS}</style>

      <div className="m1of-head">
        <div className="seal"><span>RP</span><span>DOH</span></div>
        <div className="fields">
          <div className="row">
            <span className="lab">FHSIS REPORT for the</span>
            <span className="val">{h.periodLabel || h.monthLabel || ""}</span>
            <span className="lab">of Year</span>
            <span className="val">{h.year || ""}</span>
          </div>
          <div className="row">
            <span className="lab">Name of Municipality/City</span>
            <span className="val">{h.municipality || ""}</span>
          </div>
          <div className="row">
            <span className="lab">Name of Province</span>
            <span className="val">{h.province || ""}</span>
          </div>
          <div className="row">
            <span className="lab">Projected Population of the Year</span>
            <span className="val">{h.projectedPopulation ?? ""}</span>
          </div>
          <div className="row">
            <span className="lab">Barangay / BHS</span>
            <span className="val">{[h.barangay, h.bhs].filter(Boolean).join(" / ") || ""}</span>
          </div>
        </div>
        <div className="rhu">{h.rhu || ""}</div>
      </div>

      <Blocks blocks={template} data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print hook — browser print dialog ("Save as PDF"), dedicated to this form.
// Mirrors useM1Print: portal to <body>, print-only stylesheet hides app chrome.
// ---------------------------------------------------------------------------
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 7mm 8mm; }
  html.m1of-printing, html.m1of-printing body { background: #fff !important; }
  html.m1of-printing body > *:not(.m1of-print-portal) { display: none !important; }
  html.m1of-printing .m1of-print-portal { display: block !important; }
}
.m1of-print-portal { display: none; }
`;

export function useM1OfficialPrint() {
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!payload) return undefined;
    const root = document.documentElement;
    root.classList.add("m1of-printing");
    const style = document.createElement("style");
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
    const timer = window.setTimeout(() => window.print(), 150);
    const done = () => setPayload(null);
    window.addEventListener("afterprint", done);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", done);
      style.remove();
      root.classList.remove("m1of-printing");
    };
  }, [payload]);

  const portal = payload
    ? createPortal(
        <div className="m1of-print-portal">
          <M1OfficialForm {...payload} />
        </div>,
        document.body,
      )
    : null;

  const startPrint = useCallback((data) => setPayload(data), []);
  return { startPrint, portal };
}
