import { jsPDF } from "jspdf";

/**
 * Pure renderer for the official Referral Form PDF (A4 portrait,
 * government/LGU paper layout).
 *
 * This module has NO frontend alias / network dependencies so it can be tested
 * directly in Node (mirrors m1FhsisPdfRenderer.js). `branding` is supplied by
 * the caller — loadDocumentBranding lives in the download wrapper.
 *
 * The layout reproduces the Pili Municipal Health Office Referral Form using
 * REAL PDF elements — text, thin printed rules, Admin-uploaded official logos
 * and the centralized organization/signatory data. It is never a screenshot
 * and the reference photo is never embedded.
 */

const PAGE_W = 595.28; // A4 width (pt)
const PAGE_H = 841.89; // A4 height (pt)
const MARGIN = 54;     // printable margin

/** @type {[number, number, number]} black */
const INK = [0, 0, 0];
/** @type {[number, number, number]} dark gray (secondary) */
const GRAY = [70, 70, 70];
/** @type {[number, number, number]} thin rule gray */
const RULE = [110, 110, 110];

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

const fullName = (r) =>
  [r?.first_name, r?.middle_name, r?.last_name, r?.suffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const ageFromBirthDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 200 ? String(age) : "";
};

const formatDate = (value) => {
  if (!str(value)) return "";
  const d = new Date(str(value).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return str(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

/**
 * Render the official Referral Form as a jsPDF document.
 *
 * @param {object} referral  saved health_referrals row (snake_case) or camelCase view model
 * @param {object} [branding] centralized document branding payload
 * @returns {jsPDF}
 */
export function renderReferralPdf(referral, branding = null) {
  if (!referral) return null;
  const resident = referral.resident || {};
  const patientName = fullName(resident) || str(referral.residentName) || str(referral.patient);
  const referralDate = str(referral.referralDate || referral.referral_date || referral.createdAt || referral.date);
  const scheduledAt = str(referral.scheduledAt || referral.scheduled_at || "");
  const referralNo = str(referral.referralNo || referral.reference_no || "") || "";
  const sex = str(resident.sex || referral.sex || referral.gender);
  const age = str(ageFromBirthDate(resident.birth_date || resident.birthDate) || referral.age || "");
  const address = str(resident.current_address || resident.permanent_address || referral.address || resident.barangay || referral.barangay || "");
  const referringPersonnel = str(referral.referringPersonnel || referral.referring_personnel || referral.referring_facility);
  const reason = str(referral.reason);
  const chiefComplaints = str(referral.chiefComplaints || referral.chief_complaints || reason);
  const medicalHistory = str(referral.medicalHistory || referral.medical_history || referral.notes || referral.healthHistory);
  const physicalExamFindings = str(referral.physicalExamFindings || referral.physical_exam_findings || referral.laboratoryTest || referral.laboratory_test || "");
  const impression = str(referral.impression || referral.destinationService || referral.destination_service || referral.impressionText || "");
  const destinationFacility = str(referral.destination_facility || referral.destinationFacility || referral.facility);
  const laboratoryTest = str(referral.laboratory_test || referral.laboratoryTest);
  const labRequired = Boolean(referral.laboratory_test_required ?? referral.laboratoryTestRequired);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setProperties({
    title: referralNo ? `Referral ${referralNo}` : "Referral Form",
    subject: "Referral Form",
    creator: "KALUSAGAP",
  });

  const cx = PAGE_W / 2;
  let y = MARGIN;

  // ------------------------------------------------------------- primitives
  const ensure = (h) => {
    if (y + h > PAGE_H - 48) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const setFont = (style, size) => {
    doc.setFont("times", style);
    doc.setFontSize(size);
    doc.setTextColor(...INK);
  };

  const thinRule = (x1, x2, baseline, { width = 0.6, color = RULE } = {}) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(width);
    doc.line(x1, baseline, x2, baseline);
  };

  /** "Label:" followed by a thin writing rule extending to the right margin. */
  const labeledRule = (label, x, baseline, value = "", { endX = PAGE_W - MARGIN } = {}) => {
    setFont("normal", 10.5);
    doc.text(label, x, baseline);
    const labelWidth = doc.getTextWidth(label);
    const start = x + labelWidth + 4;
    if (str(value)) {
      setFont("normal", 10.5);
      doc.text(value, start, baseline);
    }
    thinRule(start, endX, baseline + 3);
  };

  // --------------------------------------------------------------- header
  const org = branding?.organization || {};
  const municipality = str(org.municipality);
  const province = str(org.province);
  const officeName = str(org.officeName || "OFFICE OF THE MUNICIPAL HEALTH OFFICER");
  const rhuName = str(org.rhuName);
  const rhuAddress = str(org.rhuAddress || org.address);

  // Logo row — small, aspect-preserved, never dominant.
  const logoBox = 36; // ~0.5in height cap
  const addLogo = (logo, x, anchor = "left") => {
    if (!logo?.dataUrl || !logo.width || !logo.height) return;
    const scale = Math.min(logoBox / logo.width, logoBox / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    const drawX = anchor === "right" ? x - w : x;
    try {
      doc.addImage(logo.dataUrl, "PNG", drawX, y + 6, w, h);
    } catch {
      /* missing/corrupt logo → text-only header */
    }
  };
  const govtStartY = y;
  addLogo(branding?.logos?.municipal, MARGIN, "left");
  addLogo(branding?.logos?.rhu, PAGE_W - MARGIN, "right");

  setFont("normal", 11);
  doc.text("Republic of the Philippines", cx, govtStartY + 14, { align: "center" });
  setFont("normal", 11);
  doc.text(`Province of ${province || "____________________"}`, cx, govtStartY + 30, { align: "center" });
  setFont("bold", 12.5);
  doc.text(`LOCAL GOVERNMENT OF ${municipality || "______________________"}`, cx, govtStartY + 47, { align: "center" });

  y = govtStartY + 56;

  setFont("bold", 10.5);
  doc.text(rhuName === "RHU" || !rhuName ? "RURAL HEALTH UNIT" : `RURAL HEALTH UNIT ${rhuName}`, cx, y + 4, { align: "center" });
  y += 16;
  setFont("bold", 11.5);
  doc.text(officeName, cx, y + 2, { align: "center" });
  y += 16;
  if (rhuAddress) {
    setFont("normal", 9.5);
    doc.setTextColor(...GRAY);
    doc.text(rhuAddress, cx, y, { align: "center" });
    y += 14;
  }

  // Thin divider under the header.
  thinRule(MARGIN, PAGE_W - MARGIN, y + 6, { color: INK, width: 0.8 });
  y += 16;

  // ---------------------------------------------------------------- title
  setFont("bold", 16);
  doc.text("REFERRAL FORM", cx, y + 6, { align: "center" });
  const titleWidth = doc.getTextWidth("REFERRAL FORM");
  thinRule(cx - titleWidth / 2 - 8, cx + titleWidth / 2 + 8, y + 14, { color: INK, width: 0.8 });
  y += 30;

  // -------------------------------------------------------------- top strip
  // "Dr. / s:" (left) and "Date:" (right)
  setFont("normal", 10.5);
  const dateLabelX = PAGE_W - MARGIN - 100;
  doc.text("Dr. / s:", MARGIN, y + 2);
  const drStart = MARGIN + doc.getTextWidth("Dr. / s:") + 4;
  if (referringPersonnel) doc.text(referringPersonnel, drStart, y + 2);
  thinRule(drStart, dateLabelX - 12, y + 5);

  doc.text("Date:", dateLabelX, y + 2);
  const dateStart = dateLabelX + doc.getTextWidth("Date:") + 4;
  if (referralDate) doc.text(formatDate(referralDate), dateStart, y + 2);
  thinRule(dateStart, PAGE_W - MARGIN, y + 5);
  y += 18;

  // Patient information row
  setFont("normal", 10.5);
  doc.text("Name of Patient:", MARGIN, y + 2);
  const nameStart = MARGIN + doc.getTextWidth("Name of Patient:") + 4;
  if (patientName) doc.text(patientName, nameStart, y + 2);
  const ageX = 250;
  const sexX = 350;
  thinRule(nameStart, ageX - 12, y + 5);
  doc.text("Age:", ageX, y + 2);
  if (age) doc.text(age, ageX + doc.getTextWidth("Age:") + 4, y + 2);
  thinRule(ageX + doc.getTextWidth("Age:") + 4, sexX - 8, y + 5);
  doc.text("Sex:", sexX, y + 2);
  if (sex) doc.text(sex, sexX + doc.getTextWidth("Sex:") + 4, y + 2);
  thinRule(sexX + doc.getTextWidth("Sex:") + 4, PAGE_W - MARGIN, y + 5);
  y += 20;

  labeledRule("Address:", MARGIN, y + 2, address);
  y += 20;

  // --------------------------------------------------- free-writing fields
  const noteField = (label, value, lines) => {
    ensure(lines * 15 + 24);
    setFont("normal", 10.5);
    doc.text(label, MARGIN, y + 2);
    let ty = y + 12;
    const rows = str(value) ? Math.max(1, lines) : lines;
    for (let i = 0; i < rows; i += 1) {
      const textValue = str(value) && i === 0 ? str(value) : "";
      if (textValue) doc.text(textValue, MARGIN + 4, ty);
      thinRule(MARGIN + 4, PAGE_W - MARGIN, ty + 3);
      ty += 15;
    }
    y = ty + 4;
  };

  noteField("Chief Complaints:", reason, 2);
  noteField("Medical History:", notes, 2);
  noteField("PPE:", labRequired ? laboratoryTest : "", 1);
  noteField("Impression:", destinationService, 2);
  noteField("Reason for Referral:", destinationFacility ? `For ${destinationFacility}` : "", 2);

  // ------------------------------------------------------------ signature
  ensure(110);
  y += 26;
  const signatory = branding?.signatory || {};
  const signatoryName = str(signatory.fullName);
  const licenseNumber = str(signatory.licenseNumber);
  const sigX = PAGE_W - MARGIN - 150;

  setFont("bold", 10.5);
  doc.text(signatoryName || "[Authorized Signatory]", sigX + 75, y + 26, { align: "center" });
  thinRule(sigX, sigX + 150, y + 40);
  setFont("normal", 8.5);
  doc.setTextColor(...GRAY);
  doc.text("Signature over Printed Name", sigX + 75, y + 47, { align: "center" });
  setFont("normal", 9.5);
  doc.setTextColor(...INK);
  doc.text("License No.:", sigX, y + 60);
  if (licenseNumber) doc.text(licenseNumber, sigX + doc.getTextWidth("License No.:") + 4, y + 60);
  thinRule(sigX + doc.getTextWidth("License No.:") + 4, sigX + 150, y + 63);

  // -------------------------------------------------------------- footer
  const footerY = PAGE_H - 28;
  thinRule(MARGIN, PAGE_W - MARGIN, footerY, { color: RULE, width: 0.5 });
  setFont("normal", 7.5);
  doc.setTextColor(...GRAY);
  const footerText = referralNo ? `Referral No. ${referralNo}` : "Referral Form";
  doc.text(footerText, cx, footerY + 11, { align: "center" });

  return doc;
}

export default renderReferralPdf;
