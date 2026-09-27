import { jsPDF } from "jspdf";
import { buildM1MaternalForm } from "./m1MaternalForm.js";

/**
 * M1 / Maternal Health MONTHLY REPORTING FORM — official-style, multi-page,
 * landscape PDF drawn programmatically with jsPDF (the export library already
 * used across the app — no new dependency).
 *
 * This replaces the previous simplified "M1 summary" (a few statistics + a
 * participant list) with the COMPLETE FHSIS M1 "Maternal Care and Services"
 * reporting form: full identification header, blue section headers, dense
 * statistical tables with age-band and TOTAL columns, remarks columns, and
 * every indicator row preserved even at value 0.
 *
 * The layout engine handles controlled page breaks and repeats table/column
 * headers on continuation pages, then stamps page numbers on every page.
 */

// ---- palette --------------------------------------------------------------
const BLUE = [11, 74, 143]; // section headers / column headers
const SUBBAR = [225, 234, 246]; // subsection bar fill
const SUBINK = [11, 74, 143]; // subsection text
const BORDER = [148, 158, 172];
const INK = [22, 32, 47];
const GRAY = [92, 102, 118];
const WHITE = [255, 255, 255];

// ---- geometry (points, landscape US Letter) -------------------------------
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 30;
const CONTENT_W = PAGE_W - MARGIN * 2; // 732
const BOTTOM = PAGE_H - 34; // leave room for footer

const AGE_COLS = [
  { key: "code", label: "Code", w: 42, align: "center" },
  { key: "name", label: "Indicator", w: 372, align: "left" },
  { key: "a1", label: "10-14", w: 52, align: "center" },
  { key: "a2", label: "15-19", w: 52, align: "center" },
  { key: "a3", label: "20-49", w: 52, align: "center" },
  { key: "total", label: "TOTAL", w: 52, align: "center" },
  { key: "remarks", label: "Remarks", w: 110, align: "left" },
];
const COUNT_COLS = [
  { key: "code", label: "Code", w: 42, align: "center" },
  { key: "name", label: "Indicator", w: 470, align: "left" },
  { key: "total", label: "Number", w: 60, align: "center" },
  { key: "remarks", label: "Remarks", w: 160, align: "left" },
];

const withX = (cols) => {
  let x = MARGIN;
  return cols.map((c) => {
    const col = { ...c, x };
    x += c.w;
    return col;
  });
};

const PAD = 3;
const LINE_H = 7.6;

const str = (v) => (v === undefined || v === null ? "" : String(v));

// jsPDF core fonts use WinAnsi encoding, which lacks a few math/Unicode glyphs.
// Normalize them to ASCII-safe equivalents so they render (rather than as tofu).
const T = (v) =>
  str(v)
    .replace(/[≥]/g, ">=")
    .replace(/[≤]/g, "<=")
    .replace(/[–—]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/[’]/g, "'");

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Build a jsPDF document for the given form model. Returns the doc (unsaved). */
export const renderM1MaternalFormDoc = (model) => {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  let y = MARGIN;

  const setFill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setText = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const setDraw = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

  // -- continuation running header (pages 2+) -------------------------------
  const runningHeader = () => {
    setText(GRAY);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.text(
      `Monthly Form M1 — Maternal Care and Services (continued) · ${model.header.periodLabel}` +
        (model.meta.barangay ? ` · Brgy. ${model.meta.barangay}` : ""),
      MARGIN,
      y,
    );
    y += 12;
  };

  const newPage = () => {
    doc.addPage();
    y = MARGIN;
    runningHeader();
  };

  const ensure = (h) => {
    if (y + h > BOTTOM) {
      newPage();
      return true;
    }
    return false;
  };

  // -- page 1 identification block ------------------------------------------
  const drawIdentification = () => {
    setText(BLUE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(model.header.title, PAGE_W / 2, y + 4, { align: "center" });
    y += 18;
    doc.setFontSize(11);
    doc.text(model.header.formTitle, PAGE_W / 2, y, { align: "center" });
    y += 14;
    setText(GRAY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(model.header.systemLabel, PAGE_W / 2, y, { align: "center" });
    y += 14;

    // fields grid — 2 columns
    const fields = model.header.fields;
    const colW = CONTENT_W / 2;
    const rowH = 15;
    const rowsN = Math.ceil(fields.length / 2);
    setDraw(BORDER);
    doc.setLineWidth(0.5);
    for (let r = 0; r < rowsN; r += 1) {
      for (let c = 0; c < 2; c += 1) {
        const idx = r * 2 + c;
        if (idx >= fields.length) continue;
        const cx = MARGIN + c * colW;
        const cy = y + r * rowH;
        doc.rect(cx, cy, colW, rowH, "S");
        const f = fields[idx];
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        setText(INK);
        const label = `${f.label}: `;
        doc.text(label, cx + PAD, cy + rowH / 2 + 2.4);
        const lw = doc.getTextWidth(label);
        doc.setFont("helvetica", "normal");
        setText(f.value ? INK : GRAY);
        doc.text(str(f.value) || "________________", cx + PAD + lw, cy + rowH / 2 + 2.4);      }
    }
    y += rowsN * rowH;

    setText(GRAY);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.text(
      `Reporting Period: ${model.header.periodLabel}   ·   Generated: ${model.meta.generatedAt.toLocaleString()}`,
      MARGIN,
      y + 10,
    );
    y += 18;
  };

  // -- table primitives ------------------------------------------------------
  const drawSectionHeader = (section) => {
    const h = 16;
    // Keep the section header attached to its first table (subsection bar +
    // column header + at least one data row) so headers are never orphaned at
    // the bottom of a page.
    ensure(h + 13 + 14 + 20);
    setFill(BLUE);
    doc.rect(MARGIN, y, CONTENT_W, h, "F");
    setText(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`SECTION ${section.key} — ${section.title}`, MARGIN + PAD + 1, y + h / 2 + 3);
    y += h;
  };

  const drawSubBar = (subtitle) => {
    const h = 13;
    setFill(SUBBAR);
    doc.rect(MARGIN, y, CONTENT_W, h, "F");
    setDraw(BORDER);
    doc.setLineWidth(0.4);
    doc.rect(MARGIN, y, CONTENT_W, h, "S");
    setText(SUBINK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(str(subtitle), MARGIN + PAD + 1, y + h / 2 + 2.6);
    y += h;
  };

  const drawColumnHeader = (cols) => {
    const h = 14;
    setFill(BLUE);
    doc.rect(MARGIN, y, CONTENT_W, h, "F");
    setDraw(BORDER);
    doc.setLineWidth(0.4);
    setText(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.9);
    for (const col of cols) {
      doc.rect(col.x, y, col.w, h, "S");
      const tx = col.align === "left" ? col.x + PAD : col.x + col.w / 2;
      doc.text(col.label, tx, y + h / 2 + 2.4, { align: col.align === "left" ? "left" : "center" });
    }
    y += h;
  };

  const cellText = (row, key) => {
    if (key === "code") return T(row.code);
    if (key === "name") return T(row.name);
    if (key === "remarks") return T(row.remarks);
    if (key === "total") return String(row.total ?? 0);
    if (key === "a1") return String(row.byAge?.["10-14"] ?? 0);
    if (key === "a2") return String(row.byAge?.["15-19"] ?? 0);
    if (key === "a3") return String(row.byAge?.["20-49"] ?? 0);
    return "";
  };

  const drawDataRow = (cols, row) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    // measure wrapped height from name + remarks
    const nameCol = cols.find((c) => c.key === "name");
    const remCol = cols.find((c) => c.key === "remarks");
    const nameLines = doc.splitTextToSize(T(row.name), nameCol.w - PAD * 2);
    const remLines = remCol ? doc.splitTextToSize(T(row.remarks), remCol.w - PAD * 2) : [""];
    const lines = Math.max(nameLines.length, remLines.length, 1);
    const h = Math.max(14, lines * LINE_H + 6);

    if (ensure(h)) {
      // redraw context after a page break
      drawColumnHeader(cols);
    }

    // (Yellow key-cell highlighting removed by request — cells keep their normal
    // default background; position, borders, values and alignment are unchanged.)

    setDraw(BORDER);
    doc.setLineWidth(0.4);
    setText(INK);
    for (const col of cols) {
      doc.rect(col.x, y, col.w, h, "S");
      if (col.key === "name") {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.8);
        let ty = y + 6.6;
        for (const ln of nameLines) {
          doc.text(ln, col.x + PAD, ty);
          ty += LINE_H;
        }
      } else if (col.key === "remarks") {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.3);
        setText(GRAY);
        let ty = y + 6.6;
        for (const ln of remLines) {
          doc.text(ln, col.x + PAD, ty);
          ty += LINE_H;
        }
        setText(INK);
      } else {
        const bold = col.key === "total";
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(6.9);
        const tx = col.align === "left" ? col.x + PAD : col.x + col.w / 2;
        doc.text(cellText(row, col.key), tx, y + h / 2 + 2.3, {
          align: col.align === "left" ? "left" : "center",
        });
      }
    }
    y += h;
  };

  // -- compose ---------------------------------------------------------------
  drawIdentification();

  for (const section of model.sections) {
    drawSectionHeader(section);
    for (const table of section.tables) {
      const cols = withX(table.type === "count" ? COUNT_COLS : AGE_COLS);
      // keep subsection bar with its column header + first row
      ensure(13 + 14 + 16);
      drawSubBar(table.subtitle);
      drawColumnHeader(cols);
      for (const row of table.rows) drawDataRow(cols, row);
      y += 4; // gap between tables
    }
    y += 2;
  }

  // -- footer page numbers ---------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    setDraw(BORDER);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, PAGE_H - 26, PAGE_W - MARGIN, PAGE_H - 26);
    setText(GRAY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.text(
      `M1 — Maternal Care and Services · ${model.header.periodLabel}` +
        (model.meta.barangay ? ` · Brgy. ${model.meta.barangay}` : ""),
      MARGIN,
      PAGE_H - 16,
    );
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 16, { align: "right" });
    doc.text("KALUSAGAP", PAGE_W / 2, PAGE_H - 16, { align: "center" });
  }

  return doc;
};

/**
 * Build the M1 Maternal Care form from records + context and download it.
 * @param {object} args
 * @param {Array}  args.records  mapped maternal_records (camelCase view shape)
 * @param {string} args.barangay
 * @param {'monthly'|'annual'} args.period
 * @param {number} args.year
 * @param {number} args.month  0-11 (monthly only)
 * @param {object} [args.identification] optional extra header fields
 *   (municipality, province, region, facility, projectedPopulation, preparedBy, designation)
 */
export const downloadM1Report = ({ records = [], referrals = [], referralsLoaded = false, barangay, period = "monthly", year, month, identification = {} }) => {
  const model = buildM1MaternalForm(records, {
    period,
    year,
    month,
    barangay,
    referrals,
    referralsLoaded,
    ...identification,
  });
  const doc = renderM1MaternalFormDoc(model);

  const safeBarangay = str(barangay).replace(/[^\w-]+/g, "_") || "all-barangays";
  const suffix = period === "monthly" ? `${year}-${String((month ?? 0) + 1).padStart(2, "0")}` : `${year}`;
  doc.save(`M1-Maternal-Care-${safeBarangay}-${suffix}.pdf`);
};

export default { downloadM1Report, renderM1MaternalFormDoc };
