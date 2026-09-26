import { jsPDF } from "jspdf";
import { MONTH_LABELS } from "./m1Analytics";

/**
 * M1 / Maternal summary report (Letter, portrait), drawn programmatically with
 * jsPDF — the same export approach already used for referral forms
 * (`features/referrals/lib/referralPdf.js`). Every value passed in is derived
 * from real `maternal_records`; this module only lays them out.
 */

const NAVY = [11, 74, 143];
const INK = [18, 38, 63];
const GRAY = [84, 99, 122];
const RULE = [203, 206, 220];

const str = (v) => (v === undefined || v === null ? "" : String(v));

const periodLabel = ({ period, year, month }) =>
  period === "monthly" ? `${MONTH_LABELS[month]} ${year}` : `Annual ${year}`;

export const downloadM1Report = ({ barangay, period, year, month, summary = {}, monthly = [], participants = [] }) => {
  const doc = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
  const MARGIN = 0.6;
  const PAGE_W = 8.5;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  let y = MARGIN;

  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("M1 / Maternal Health Summary", MARGIN, y);
  y += 0.28;

  doc.setTextColor(...GRAY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("KALUSAGAP · Community Health Risk Monitoring and Early Intervention System", MARGIN, y);
  y += 0.22;

  doc.setTextColor(...INK);
  doc.setFontSize(10.5);
  doc.text(`Barangay: ${str(barangay) || "—"}`, MARGIN, y);
  doc.text(`Reporting period: ${periodLabel({ period, year, month })}`, MARGIN + CONTENT_W / 2, y);
  y += 0.2;
  doc.setTextColor(...GRAY);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, MARGIN, y);
  y += 0.25;

  doc.setDrawColor(...RULE);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 0.3;

  // Summary metrics
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text("Summary", MARGIN, y);
  y += 0.24;

  const metrics = [
    ["Total M1 participants", summary.total ?? 0],
    ["Active maternal cases", summary.active ?? 0],
    ["Completed / monitored", summary.completed ?? 0],
    ["Follow-ups due", summary.followUpsDue ?? 0],
    ["Recorded prenatal visits", summary.prenatalVisits ?? 0],
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  metrics.forEach(([label, value]) => {
    doc.setTextColor(...GRAY);
    doc.text(String(label), MARGIN, y);
    doc.setTextColor(...INK);
    doc.text(String(value), PAGE_W - MARGIN, y, { align: "right" });
    y += 0.22;
  });
  y += 0.15;

  // Monthly breakdown (annual reports)
  if (period === "annual" && Array.isArray(monthly) && monthly.length) {
    doc.setDrawColor(...RULE);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 0.28;
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text("Monthly M1 Participation", MARGIN, y);
    y += 0.24;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    monthly.forEach((row) => {
      doc.setTextColor(...GRAY);
      doc.text(String(row.label || row.month), MARGIN, y);
      doc.setTextColor(...INK);
      doc.text(String(row.count ?? 0), PAGE_W - MARGIN, y, { align: "right" });
      y += 0.2;
      if (y > 10.2) { doc.addPage(); y = MARGIN; }
    });
    y += 0.15;
  }

  // Participant list
  if (Array.isArray(participants) && participants.length) {
    if (y > 9.3) { doc.addPage(); y = MARGIN; }
    doc.setDrawColor(...RULE);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 0.28;
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(`Participants (${participants.length})`, MARGIN, y);
    y += 0.24;

    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text("Name", MARGIN, y);
    doc.text("Status", MARGIN + 3.2, y);
    doc.text("Visits", MARGIN + 4.6, y);
    doc.text("First recorded", MARGIN + 5.4, y);
    y += 0.16;
    doc.setDrawColor(...RULE);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 0.16;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    participants.forEach((p) => {
      if (y > 10.4) { doc.addPage(); y = MARGIN; }
      doc.text(str(p.residentName).slice(0, 32) || "—", MARGIN, y);
      doc.text(str(p.status) || "—", MARGIN + 3.2, y);
      doc.text(String(p.prenatalVisits ?? 0), MARGIN + 4.6, y);
      doc.text(str(p.recordedAt).slice(0, 10) || "—", MARGIN + 5.4, y);
      y += 0.2;
    });
  }

  const safeBarangay = str(barangay).replace(/[^\w-]+/g, "_") || "barangay";
  const suffix = period === "monthly" ? `${year}-${String((month ?? 0) + 1).padStart(2, "0")}` : `${year}`;
  doc.save(`M1-${period}-summary-${safeBarangay}-${suffix}.pdf`);
};

export default { downloadM1Report };
