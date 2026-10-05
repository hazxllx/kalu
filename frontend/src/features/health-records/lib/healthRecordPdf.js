import { jsPDF } from "jspdf";

/**
 * "My Health Record" PDF export (A4, portrait) — black & white / grayscale.
 *
 * Drawn programmatically with jsPDF (already a project dependency — the same
 * library used by the referral and M1 exports) so the output is a real,
 * professional PDF document, never a screenshot or a renamed JSON file.
 *
 * Design intent: a clean, printable municipal/community health record. It uses
 * only black text on a white background with black borders and light-gray table
 * shading. No brand colours, coloured section backgrounds, logos or decorative
 * elements appear in the PDF (this does NOT change the website's colour scheme).
 *
 * The generator consumes the SAME data object the "My Health Record" page loads
 * from `residentsApi.myHealthRecords()` — the authenticated resident's own
 * profile plus their completed consultations (each with its vitals). It fetches
 * nothing itself and fabricates nothing: internal identifiers (consultation
 * ids / UUIDs / primary keys) are never printed, and fields the data model does
 * not provide render as "Not available" or an empty-state line.
 *
 * The layout engine paginates automatically: long consultation histories and
 * tables flow onto additional pages, text wraps (never clipped), margins are
 * preserved, and every page footer shows the system name and "Page X of Y".
 *
 * @param {object} data          the health-record object from the page
 * @param {object} data.resident basic profile { name, barangay, birthDate, age, sex, bloodType? }
 * @param {Array}  data.consultations consultation history (each with .vitals)
 * @param {Array}  [data.vaccinations] optional vaccination records
 * @param {Array}  [data.labs]         optional laboratory records
 * @param {object} [data.medicalHistory] optional medical history / allergies
 * @param {object} [meta] optional fallback identity (e.g. from the auth session)
 * @returns {Promise<string>} the downloaded file name
 */

const PAGE_W = 595.28; // A4 width in pt
const PAGE_H = 841.89; // A4 height in pt
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_RESERVE = 44;

// Grayscale-only palette (printable black & white).
/** @type {[number, number, number]} */
const BLACK = [0, 0, 0];
/** @type {[number, number, number]} */
const DARK = [30, 30, 30];
/** @type {[number, number, number]} */
const LABEL = [70, 70, 70];
/** @type {[number, number, number]} */
const RULE = [0, 0, 0];
/** @type {[number, number, number]} */
const HEADER_FILL = [225, 225, 225]; // light gray table header
/** @type {[number, number, number]} */
const ZEBRA = [244, 244, 244]; // very light gray alternating rows

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
/** Value when present, otherwise the explicit "Not available" sentinel. */
const orNA = (v) => (str(v) === "" ? "Not available" : str(v));

/** Sanitize the resident name into a safe filename fragment. */
export const safeFilePart = (name) =>
  str(name)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "Resident";

/** "1988-07-27" (or ISO) -> "July 27, 1988"; blank stays blank. */
function formatLongDate(value) {
  const raw = str(value);
  if (!raw) return "";
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** "14:30" -> "2:30 PM"; blank stays blank. */
function formatTime12h(value) {
  const raw = str(value);
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return raw;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

/** BMI to two decimals when numeric; otherwise the raw string. */
function formatBmi(value) {
  const n = Number(value);
  if (str(value) === "" || Number.isNaN(n)) return str(value);
  return n.toFixed(2);
}

export async function downloadHealthRecordPdf(data = {}, meta = {}) {
  const resident = data.resident || {};
  const consultations = Array.isArray(data.consultations) ? data.consultations : [];
  const vaccinations = Array.isArray(data.vaccinations) ? data.vaccinations : [];
  const labs = Array.isArray(data.laboratoryResults)
    ? data.laboratoryResults
    : Array.isArray(data.labs)
      ? data.labs
      : [];
  const medicalHistory = data.medicalHistory || {};

  const residentName = str(resident.name) || str(resident.fullName) || str(meta.name) || "Resident";
  const barangay = str(resident.barangay) || str(meta.barangay);
  const generatedAt = data.generatedAt || new Date().toISOString();
  const generatedDate = formatLongDate(generatedAt.slice(0, 10));
  const cx = PAGE_W / 2;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setProperties({
    title: `KALUSAGAP Health Record — ${residentName}`,
    subject: "Resident Health Record",
    creator: "KALUSAGAP",
  });

  let y = MARGIN;

  // --------------------------------------------------------------- primitives
  const bottomLimit = () => PAGE_H - FOOTER_RESERVE;
  const ensure = (h) => {
    if (y + h > bottomLimit()) {
      doc.addPage();
      y = MARGIN;
    }
  };

  /** Section heading: bold black text with a black underline rule (no fill). */
  const sectionHeader = (title) => {
    ensure(26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BLACK);
    doc.text(String(title).toUpperCase(), MARGIN, y + 11);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(1);
    doc.line(MARGIN, y + 15, MARGIN + CONTENT_W, y + 15);
    y += 24;
  };

  /** One "Label: value" row with a wrapped value. */
  const fieldRow = (label, value, { labelW = 155 } = {}) => {
    const valueW = CONTENT_W - labelW;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(orNA(value), valueW);
    const rowH = Math.max(13, lines.length * 12) + 3;
    ensure(rowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...LABEL);
    doc.text(String(label), MARGIN, y + 9.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...BLACK);
    doc.text(lines, MARGIN + labelW, y + 9.5);
    y += rowH;
  };

  /** Two-column grid of label-over-value cells (resident information block). */
  const infoGrid = (pairs) => {
    const colGap = 18;
    const colW = (CONTENT_W - colGap) / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      const rowPairs = pairs.slice(i, i + 2);
      const measured = rowPairs.map((p, idx) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        return { p, x: MARGIN + idx * (colW + colGap), lines: doc.splitTextToSize(orNA(p.value), colW) };
      });
      const rowH = 14 + Math.max(...measured.map((m) => m.lines.length)) * 12 + 6;
      ensure(rowH);
      measured.forEach((m) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...LABEL);
        doc.text(String(m.p.label).toUpperCase(), m.x, y + 8);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...BLACK);
        doc.text(m.lines, m.x, y + 20);
      });
      y += rowH;
    }
  };

  /** Paginated table; repeats its header on every page the table spans. */
  const table = (columns, rows, { fontSize = 8 } = {}) => {
    const totalW = columns.reduce((s, c) => s + c.width, 0);
    const scaled = columns.map((c) => ({ ...c, w: (c.width / totalW) * CONTENT_W }));
    const pad = 4;
    const lineH = fontSize + 2.5;

    const drawHeader = () => {
      ensure(16);
      doc.setFillColor(...HEADER_FILL);
      doc.rect(MARGIN, y, CONTENT_W, 15, "F");
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.5);
      doc.rect(MARGIN, y, CONTENT_W, 15, "S");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fontSize);
      doc.setTextColor(...BLACK);
      let x = MARGIN;
      scaled.forEach((c) => {
        doc.text(String(c.header), x + pad, y + 10.5);
        x += c.w;
      });
      y += 15;
    };

    drawHeader();
    rows.forEach((row, index) => {
      const cells = scaled.map((c) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(fontSize);
        return doc.splitTextToSize(orNA(row[c.key]), c.w - pad * 2);
      });
      const rowH = Math.max(...cells.map((l) => l.length)) * lineH + 4;
      if (y + rowH > bottomLimit()) {
        doc.addPage();
        y = MARGIN;
        drawHeader();
      }
      if (index % 2 === 1) {
        doc.setFillColor(...ZEBRA);
        doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fontSize);
      doc.setTextColor(...BLACK);
      let x = MARGIN;
      scaled.forEach((c, ci) => {
        doc.text(cells[ci], x + pad, y + lineH - 1);
        x += c.w;
      });
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);
      y += rowH;
    });
    y += 8;
  };

  const emptyLine = (message) => {
    ensure(18);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    doc.setTextColor(...LABEL);
    doc.text(message, MARGIN, y + 10);
    y += 20;
  };

  // ------------------------------------------------------------------ header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...BLACK);
  doc.text("KALUSAGAP", cx, y + 16, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text("COMMUNITY HEALTH SYSTEM", cx, y + 31, { align: "center" });
  y += 44;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BLACK);
  doc.text("MY HEALTH RECORD", cx, y + 6, { align: "center" });
  y += 16;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(1.2);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 14;

  // Resident / Barangay / Generated summary lines.
  const summary = (label, value) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...LABEL);
    doc.text(label, MARGIN, y + 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...BLACK);
    doc.text(orNA(value), MARGIN + 78, y + 9);
    y += 15;
  };
  summary("Resident:", residentName);
  summary("Barangay:", barangay);
  summary("Generated:", generatedDate);
  y += 8;

  // --------------------------------------------------- resident information
  sectionHeader("Resident Information");
  infoGrid([
    { label: "Full Name", value: residentName },
    { label: "Barangay", value: barangay },
    { label: "Birth Date", value: formatLongDate(resident.birthDate) },
    {
      label: "Age",
      value:
        resident.age === null || resident.age === undefined || resident.age === "" ? "" : `${resident.age}`,
    },
    { label: "Sex", value: resident.sex },
    { label: "Blood Type", value: resident.bloodType },
  ]);
  y += 4;

  // ----------------------------------------------------- consultation history
  sectionHeader("Consultation History");
  if (consultations.length === 0) {
    emptyLine("No records available.");
  } else {
    consultations.forEach((c) => {
      // Consultation heading — the date only, never an internal identifier.
      ensure(18);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...BLACK);
      doc.text(c.date ? `Consultation — ${formatLongDate(c.date)}` : "Consultation", MARGIN, y + 10);
      y += 16;

      fieldRow("Date", formatLongDate(c.date));
      fieldRow("Time", formatTime12h(c.time));
      fieldRow("Seen By", c.seenBy);
      fieldRow("Status", c.status);
      fieldRow("Chief Complaint", c.chiefComplaint);
      fieldRow("Findings", c.findings);
      fieldRow("Diagnosis", c.diagnosis);
      fieldRow("Treatment Given", c.treatmentGiven);
      fieldRow("Medications", c.medications);
      fieldRow("Recommendations", c.recommendations);
      fieldRow("Follow-up Required", c.followUpRequired);
      fieldRow("Next Visit Date", c.nextVisitDate ? formatLongDate(c.nextVisitDate) : "");

      // Vital signs for this consultation.
      const v = c.vitals || {};
      ensure(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text("VITAL SIGNS", MARGIN, y + 9);
      y += 14;
      const vitalPairs = [
        ["Blood Pressure", str(v.bloodPressure) ? `${v.bloodPressure} mmHg` : ""],
        ["Temperature", str(v.temperature) !== "" ? `${v.temperature} °C` : ""],
        ["Pulse Rate", str(v.pulseRate) !== "" ? `${v.pulseRate} bpm` : ""],
        ["Respiratory Rate", str(v.respiratoryRate) !== "" ? `${v.respiratoryRate} breaths/min` : ""],
        ["Oxygen Saturation", str(v.oxygenSaturation) !== "" ? `${v.oxygenSaturation} %` : ""],
        ["Height", str(v.height) !== "" ? `${v.height} cm` : ""],
        ["Weight", str(v.weight) !== "" ? `${v.weight} kg` : ""],
        ["BMI", formatBmi(v.bmi)],
        ["BMI Category", v.bmiCategory],
      ];
      const colGap = 18;
      const colW = (CONTENT_W - colGap) / 2;
      for (let i = 0; i < vitalPairs.length; i += 2) {
        const rowPairs = vitalPairs.slice(i, i + 2);
        ensure(14);
        rowPairs.forEach(([label, value], idx2) => {
          const x = MARGIN + idx2 * (colW + colGap);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(...LABEL);
          doc.text(`${label}:`, x, y + 9);
          doc.setTextColor(...BLACK);
          doc.text(orNA(value), x + 100, y + 9);
        });
        y += 13;
      }

      // Divider between consultations.
      y += 6;
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.4);
      ensure(4);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 12;
    });
  }

  // ----------------------------------------------- medical history & allergies
  sectionHeader("Medical History & Allergies");
  fieldRow("Chronic Conditions", medicalHistory.chronicConditions);
  fieldRow("Allergies", medicalHistory.allergies);
  fieldRow("Current Medications", medicalHistory.currentMedications);
  fieldRow("Pregnancy Status", medicalHistory.pregnancyStatus);
  y += 4;

  // ------------------------------------------------------------- vaccinations
  sectionHeader("Vaccinations");
  if (vaccinations.length === 0) {
    emptyLine("No records available.");
  } else {
    table(
      [
        { header: "Date", key: "date", width: 18 },
        { header: "Vaccine", key: "vaccine", width: 28 },
        { header: "Dose", key: "dose", width: 14 },
        { header: "Provider", key: "provider", width: 26 },
        { header: "Status", key: "status", width: 14 },
      ],
      vaccinations.map((v) => ({
        date: v.date ? formatLongDate(v.date) : "",
        vaccine: v.vaccine || v.name,
        dose: v.dose,
        provider: v.provider,
        status: v.status,
      })),
    );
  }
  y += 4;

  // -------------------------------------------------------- laboratory results
  sectionHeader("Laboratory Results");
  if (labs.length === 0) {
    emptyLine("No records available.");
  } else {
    table(
      [
        { header: "Date", key: "date", width: 20 },
        { header: "Test", key: "test", width: 30 },
        { header: "Result", key: "result", width: 26 },
        { header: "Remarks", key: "remarks", width: 24 },
      ],
      labs.map((l) => ({
        date: l.date ? formatLongDate(l.date) : "",
        test: l.test || l.name,
        result: l.result,
        remarks: l.remarks,
      })),
    );
  }

  // ------------------------------------------------------------------ footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    const footerY = PAGE_H - 26;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, footerY, MARGIN + CONTENT_W, footerY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text("KALUSAGAP Community Health System", MARGIN, footerY + 13);
    doc.text(`Page ${p} of ${totalPages}`, MARGIN + CONTENT_W, footerY + 13, { align: "right" });
  }

  const fileName = `KALUSAGAP_Health_Record_${safeFilePart(residentName)}_${generatedAt.slice(0, 10)}.pdf`;
  doc.save(fileName);
  return fileName;
}

export default downloadHealthRecordPdf;
