import { jsPDF } from "jspdf";
import { LOGO_URL } from "@/lib/brand";

/**
 * Barangay -> RHU referral form PDF (Letter/"short" 8.5 x 11 in, portrait).
 *
 * The document is drawn programmatically with jsPDF so it reads as an
 * official health referral form — not a screenshot of the web app. Every
 * value comes from the saved referral record (optionally enriched with the
 * linked resident record); fields with no data in the record render as blank
 * ruled lines to be filled in by hand.
 */

const PAGE_W = 8.5;
const PAGE_H = 11;
const MARGIN = 0.45;
const CONTENT_W = PAGE_W - MARGIN * 2;

const NAVY = [11, 74, 143]; // brand-blue
const INK = [18, 38, 63]; // brand-ink
const GRAY = [84, 99, 122]; // brand-gray
const RULE = [203, 206, 220]; // rule lines
const LIGHT = [237, 243, 250]; // brand-light

const MUNICIPALITY = "Municipality of Pili";
const OFFICE_LINE = "Municipal Health Office · Rural Health Unit";
const SYSTEM_LINE = "KALUSAGAP · Community Health Risk Monitoring and Early Intervention System";

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** Loads the bundled KALUSAGAP logo and re-encodes it for jsPDF. */
function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = LOGO_URL;
  });
}

function formatDateTime(value) {
  if (!str(value)) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return str(value);
  const date = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/**
 * Generates and downloads the referral PDF.
 *
 * @param {object} referral the saved referral record
 * @param {{ residents?: Array }} [options] roster used to enrich resident
 *   details via the referral's residentId (optional)
 */
export async function downloadReferralPdf(referral, { residents = [] } = {}) {
  if (!referral) return;

  const linked = referral.residentId ? residents.find((r) => r.id === referral.residentId) : null;
  const referralNo = str(referral.referralNo) || `RH-${str(referral.id).padStart(6, "0")}`;
  const dateTime = str(referral.createdAt) ? formatDateTime(referral.createdAt) : str(referral.date);
  const barangay = str(referral.barangay ?? (linked && linked.barangay));
  const vitals = referral.vitals || {};
  const cx = PAGE_W / 2;

  const doc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
  doc.setProperties({
    title: `Referral ${referralNo}`,
    subject: "Barangay to RHU Referral Form",
    creator: "KALUSAGAP",
  });

  let y = MARGIN;

  // Only break pages when an element genuinely cannot fit — the form is laid
  // out to fit a single page for typical records.
  const ensure = (h) => {
    if (y + h > PAGE_H - 0.42) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const label = (text, x, baseline) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...GRAY);
    doc.text(String(text).toUpperCase(), x, baseline);
  };

  const rule = (x1, x2, baseline) => {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.008);
    doc.line(x1, baseline, x2, baseline);
  };

  /** Row of label-over-value cells with thin rules (2 or 3 columns). */
  const fieldRow = (cells) => {
    const gap = 0.16;
    const w = (CONTENT_W - gap * (cells.length - 1)) / cells.length;
    ensure(0.4);
    let x = MARGIN;
    cells.forEach((c) => {
      label(c.label, x, y + 0.09);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      const lines = str(c.value) ? doc.splitTextToSize(str(c.value), w - 0.04).slice(0, 2) : [];
      if (lines.length) doc.text(lines, x, y + 0.24);
      rule(x, x + w - 0.02, y + 0.285);
      x += w + gap;
    });
    y += 0.36;
  };

  /** Full-width field with one ruled line per row of text. */
  const noteField = (lbl, value) => {
    const lines = str(value) ? doc.splitTextToSize(str(value), CONTENT_W - 0.04) : [];
    const rows = Math.max(1, lines.length);
    ensure(0.16 + rows * 0.15 + 0.08);
    label(lbl, MARGIN, y + 0.09);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    let ty = y + 0.24;
    for (let i = 0; i < rows; i += 1) {
      if (lines[i]) doc.text(lines[i], MARGIN, ty);
      rule(MARGIN, MARGIN + CONTENT_W, ty + 0.045);
      ty += 0.15;
    }
    y += 0.14 + rows * 0.15 + 0.05;
  };

  const sectionHeader = (title) => {
    ensure(0.3);
    doc.setFillColor(...NAVY);
    doc.rect(MARGIN, y, CONTENT_W, 0.21, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.setTextColor(255, 255, 255);
    doc.text(title, MARGIN + 0.09, y + 0.145);
    y += 0.29;
  };

  // ------------------------------------------------------------------ header
  const logo = await loadLogo();
  if (logo) {
    const box = 0.58;
    const scale = Math.min(box / logo.width, box / logo.height);
    doc.addImage(logo.dataUrl, "PNG", MARGIN, y + 0.02, logo.width * scale, logo.height * scale);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(MUNICIPALITY.toUpperCase(), cx, y + 0.12, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(OFFICE_LINE, cx, y + 0.26, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(
    barangay ? `BARANGAY ${barangay.toUpperCase()}` : "BARANGAY ______________________",
    cx,
    y + 0.41,
    { align: "center" }
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.setTextColor(...GRAY);
  doc.text(SYSTEM_LINE, cx, y + 0.55, { align: "center" });
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.018);
  doc.line(MARGIN, y + 0.64, MARGIN + CONTENT_W, y + 0.64);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.008);
  doc.line(MARGIN, y + 0.68, MARGIN + CONTENT_W, y + 0.68);
  y += 0.78;

  // Title band
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN, y, CONTENT_W, 0.28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("BARANGAY TO RHU REFERRAL FORM", cx, y + 0.19, { align: "center" });
  y += 0.28;

  // Referral No. / Date and Time strip
  doc.setFillColor(...LIGHT);
  doc.rect(MARGIN, y, CONTENT_W, 0.28, "F");
  const stripColX = MARGIN + CONTENT_W * 0.55;
  label("Referral No.", MARGIN + 0.1, y + 0.105);
  label("Date and Time", stripColX, y + 0.105);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(referralNo, MARGIN + 0.1, y + 0.225);
  doc.text(dateTime, stripColX, y + 0.225);
  y += 0.34;

  // --------------------------------------------------- I. resident information
  sectionHeader("I. RESIDENT INFORMATION");
  fieldRow([
    { label: "Full Name", value: str(referral.resident) || str(linked && linked.name) },
    { label: "Resident ID", value: str(referral.residentId) || str(linked && linked.id) },
  ]);
  fieldRow([
    { label: "Age", value: str(referral.age ?? (linked && linked.age)) },
    { label: "Sex", value: str(referral.sex ?? (linked && linked.gender)) },
  ]);
  fieldRow([
    { label: "Date of Birth", value: str(referral.dateOfBirth ?? (linked && linked.dateOfBirth)) },
    { label: "Civil Status", value: str(referral.civilStatus ?? (linked && linked.civilStatus)) },
  ]);
  fieldRow([
    { label: "Address", value: str(referral.address ?? (linked && linked.address)) },
    { label: "Contact Number", value: str(referral.contact ?? (linked && linked.contact)) },
  ]);

  // -------------------------------------------------- II. referral information
  sectionHeader("II. REFERRAL INFORMATION");
  fieldRow([
    { label: "Referring Barangay", value: barangay ? `Barangay ${barangay}` : "" },
    { label: "Referring Personnel", value: str(referral.referringPersonnel) },
  ]);
  fieldRow([
    { label: "Referring Personnel Role", value: str(referral.referringPersonnelRole) },
    { label: "Date and Time of Referral", value: dateTime },
  ]);
  fieldRow([
    { label: "Referral Category / Urgency", value: str(referral.priority) },
    { label: "Receiving Facility", value: str(referral.facility) },
  ]);
  noteField("Reason for Referral", referral.reason);

  // ---------------------------------------------------- III. health information
  sectionHeader("III. HEALTH INFORMATION");
  fieldRow([
    { label: "Chief Complaint / Main Health Concern", value: str(referral.chiefComplaint) },
    { label: "Symptoms / Concerns", value: str(referral.symptoms) },
  ]);
  noteField("Relevant Health History", referral.healthHistory);
  fieldRow([
    { label: "Blood Pressure", value: str(vitals.bp) },
    { label: "Heart Rate", value: str(vitals.hr) },
    { label: "Respiratory Rate", value: str(vitals.rr) },
  ]);
  fieldRow([
    { label: "Temperature", value: str(vitals.temp) },
    { label: "SpO2", value: str(vitals.spo2) },
    { label: "Weight", value: str(vitals.weight) },
  ]);
  fieldRow([
    { label: "Observations", value: str(referral.observations) },
    { label: "Additional Notes", value: str(referral.notes) },
  ]);

  // -------------------------------------------------------- IV. RHU PHN section
  sectionHeader("IV. RHU PUBLIC HEALTH NURSE SECTION");
  fieldRow([
    { label: "RHU Public Health Nurse (PHN)", value: str(referral.phn) },
    { label: "Date and Time Received", value: str(referral.receivedAt) },
  ]);
  fieldRow([
    { label: "Assessment / Remarks", value: str(referral.assessment) },
    { label: "Action Taken", value: str(referral.actionTaken) },
  ]);
  fieldRow([
    { label: "Referral Status", value: str(referral.status) },
    { label: "Additional Instructions / Notes", value: str(referral.instructions) },
  ]);

  // ----------------------------------------------------------- V. signatures
  sectionHeader("V. SIGNATURES");
  ensure(1.6);
  const colGap = 0.4;
  const colW = (CONTENT_W - colGap) / 2;
  const lx = MARGIN;
  const rx = MARGIN + colW + colGap;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...NAVY);
  doc.text("REFERRING PERSONNEL", lx, y + 0.09);
  doc.text("RHU PUBLIC HEALTH NURSE (PHN)", rx, y + 0.09);
  y += 0.2;

  const sigY = y + 0.4;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.01);
  doc.line(lx, sigY, lx + colW, sigY);
  doc.line(rx, sigY, rx + colW, sigY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.setTextColor(...GRAY);
  doc.text("Signature over Printed Name", lx + colW / 2, sigY + 0.11, { align: "center" });
  doc.text("Signature over Printed Name", rx + colW / 2, sigY + 0.11, { align: "center" });
  y = sigY + 0.22;

  const sigRow = (lbl, leftValue, rightValue) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...GRAY);
    doc.text(`${String(lbl).toUpperCase()}:`, lx, y + 0.07);
    doc.text(`${String(lbl).toUpperCase()}:`, rx, y + 0.07);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    const l = str(leftValue);
    const r = str(rightValue);
    if (l) doc.text(doc.splitTextToSize(l, colW - 0.9).slice(0, 1), lx + 0.88, y + 0.07);
    if (r) doc.text(doc.splitTextToSize(r, colW - 0.9).slice(0, 1), rx + 0.88, y + 0.07);
    y += 0.22;
  };
  sigRow("Printed Name", referral.referringPersonnel, referral.phn);
  sigRow("Role / Position", referral.referringPersonnelRole, "");
  sigRow("Date and Time", dateTime, "");

  // ------------------------------------------------------------------- footer
  const footerY = PAGE_H - 0.3;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.008);
  doc.line(MARGIN, footerY, MARGIN + CONTENT_W, footerY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.setTextColor(...GRAY);
  doc.text("Generated by KALUSAGAP — Community Health Risk Monitoring and Early Intervention System", cx, footerY + 0.11, {
    align: "center",
  });
  doc.text(`Referral No. ${referralNo}`, cx, footerY + 0.21, { align: "center" });

  doc.save(`Referral-${referralNo}.pdf`);
}
