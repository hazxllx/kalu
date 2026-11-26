// frontend/src/features/referrals/lib/referralPdfRenderer.js
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
  [r?.first_name || r?.firstName, r?.middle_name || r?.middleName, r?.last_name || r?.lastName, r?.suffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const ageFromBirthDate = (iso, at = new Date()) => {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date(at);
  if (Number.isNaN(now.getTime())) return "";
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
  const legacy = referral.legacy_links?.[0]?.legacy_snapshot;
  const snapshot = !referral.snapshot_synced_at && legacy?.patient_snapshot
    ? legacy.patient_snapshot
    : referral.patient_snapshot || referral.patientSnapshot;
  const hasSnapshot = snapshot && Object.keys(snapshot).length > 0;
  const resident = referral.resident && Object.keys(referral.resident).length
    ? referral.resident
    : hasSnapshot ? snapshot : {};
  const patientName = fullName(resident) || str(referral.residentName) || str(referral.patient);
  const referralDate = str(referral.referralDate || referral.referral_date || referral.createdAt || referral.date);
  const createdAt = str(referral.created_at || referral.createdAt);
  const scheduledAt = str(referral.scheduledAt || referral.scheduled_at || "");
  const referralNo = str(referral.referralNo || referral.reference_no || referral.legacy_links?.[0]?.legacy_referral_id || referral.id);
  const sex = str(resident.sex || referral.sex || referral.gender);
  const age = str((hasSnapshot ? resident.age ?? ageFromBirthDate(resident.birth_date || resident.birthDate, referralDate || new Date()) : ageFromBirthDate(resident.birth_date || resident.birthDate)) || referral.age || "");
  const address = str(resident.current_address || resident.currentAddress || resident.permanent_address || resident.permanentAddress || referral.address || resident.barangay || referral.barangay || "");
  const birthDate = str(resident.birth_date || resident.birthDate);
  const patientContact = str(resident.cellphone_no || resident.cellphoneNo || referral.contactNumber);
  const referringPersonnel = str(referral.sender?.full_name || referral.referringPersonnel || referral.referring_personnel || legacy?.referring_personnel);
  const referringFacility = str(referral.referring_facility || referral.referringFacility);
  const referringFacilityAddress = str(referral.referring_facility_address || referral.referringFacilityAddress);
  const referringContact = str(referral.referring_contact || referral.referringContact);
  const reason = str(referral.reason);
  const encounter = referral.encounter || {};
  const chiefComplaints = str(referral.chiefComplaints || referral.chief_complaints || encounter.chief_complaint);
  const medicalHistory = str(referral.medicalHistory || referral.medical_history || encounter.clinical_history);
  const physicalExamFindings = str(referral.physicalExamFindings || referral.physical_exam_findings || encounter.findings);
  const impression = str(referral.impression || encounter.phn_assessment);
  const treatmentGiven = str(encounter.treatment_given || referral.treatmentGiven || referral.treatment_given);
  const recommendations = str(encounter.recommendation || referral.recommendation);
  const encounterNotes = str(encounter.phn_notes || referral.notes);
  const referralVitals = referral.referral_vitals || referral.referralVitals || {};
  const referralHeight = referralVitals.heightCm ?? referralVitals.height_cm;
  const referralWeight = referralVitals.weightKg ?? referralVitals.weight_kg;
  const referralBmi = Number(referralHeight) > 0 && Number(referralWeight) > 0
    ? (Number(referralWeight) / ((Number(referralHeight) / 100) ** 2)).toFixed(2) : "";
  const vitals = {
    bp: str(referralVitals.bp || encounter.bp || encounter.vitals?.bp),
    hr: str(referralVitals.hr ?? encounter.hr ?? encounter.vitals?.hr),
    rr: str(referralVitals.rr ?? encounter.rr ?? encounter.vitals?.rr),
    o2sat: str(referralVitals.o2sat ?? encounter.o2sat ?? encounter.vitals?.o2sat),
    temperature: str(referralVitals.temperature ?? encounter.temperature ?? encounter.vitals?.temperature),
    height: str(referralVitals.heightCm ?? encounter.height_cm ?? encounter.vitals?.height_cm),
    weight: str(referralVitals.weightKg ?? encounter.weight_kg ?? encounter.vitals?.weight_kg),
    bmi: str(referralVitals.bmi ?? encounter.bmi ?? encounter.vitals?.bmi ?? referralBmi),
  };
  const destinationFacility = str(referral.destination_facility || referral.destinationFacility || referral.facility);
  const inSystemFacility = (referral.recipient_personnel_id || referral.recipientPersonnelId) ? destinationFacility : "";
  const receivingAddress = str(referral.recipient_facility?.address || referral.receivingFacilityAddress);
  const recipient = (referral.recipient_personnel_id || referral.recipientPersonnelId)
    ? str(referral.recipient?.full_name || referral.recipientName) : str(referral.receivingPersonnel);
  const recipientRole = str(referral.recipient_role || referral.recipientRole);
  const recipientStation = str(referral.recipient_station || referral.recipientStation);
  const externalFacility = str(referral.external_receiving_facility || referral.externalReceivingFacility);
  const externalAddress = str(referral.external_receiving_address || referral.externalReceivingAddress);
  const externalRole = str(referral.external_receiving_role || referral.externalReceivingRole);
  const externalRecipient = str(referral.external_recipient_name || referral.externalRecipientName);
  const externalPosition = str(referral.external_recipient_position || referral.externalRecipientPosition);
  const referralCategory = str(referral.referral_category || referral.referralCategory);
  const priority = str(referral.priority);
  const status = str(referral.status);
  const destinationService = str(referral.destination_service || referral.destinationService);
  const laboratory = referral.laboratory_test_required || referral.laboratoryTestRequired
    ? str(referral.laboratory_test || referral.laboratoryTest) : "Not required";

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

  // --------------------------- structured content (branded header unchanged)
  const contentW = PAGE_W - 2 * MARGIN;
  const bottom = PAGE_H - 48;
  const missing = "Not provided";
  const sectionHeading = (title) => {
    ensure(26);
    setFont("bold", 10);
    doc.text(title.toUpperCase(), MARGIN, y + 10);
    thinRule(MARGIN, PAGE_W - MARGIN, y + 15, { color: RULE, width: 0.45 });
    y += 22;
  };

  const gridSection = (title, fields, columns = 2) => {
    if (title) sectionHeading(title);
    const gap = 6;
    const colW = (contentW - gap * (columns - 1)) / columns;
    for (let start = 0; start < fields.length; start += columns) {
      const row = fields.slice(start, start + columns);
      const prepared = row.map(([label, value]) => {
        const textValue = str(value) || missing;
        setFont("normal", 9.2);
        const lines = doc.splitTextToSize(textValue, colW - 4);
        return { label, lines, height: 19 + lines.length * 10 };
      });
      const rowHeight = Math.max(30, ...prepared.map((item) => item.height));
      ensure(rowHeight + 2);
      prepared.forEach((item, index) => {
        const x = MARGIN + index * (colW + gap);
        setFont("bold", 8.2);
        doc.setTextColor(...GRAY);
        doc.text(item.label.toUpperCase(), x, y + 8);
        setFont("normal", 9.2);
        doc.text(item.lines, x, y + 19);
      });
      y += rowHeight + 2;
    }
    y += 4;
  };

  const paragraphField = (label, value) => {
    const textValue = str(value) || missing;
    setFont("normal", 9.5);
    const lines = doc.splitTextToSize(textValue, contentW - 12);
    ensure(25);
    setFont("bold", 9);
    doc.text(label, MARGIN + 2, y + 9);
    y += 14;
    setFont("normal", 9.5);
    for (const line of lines) {
      if (y + 12 > bottom) { doc.addPage(); y = MARGIN; }
      doc.text(line, MARGIN + 5, y + 8);
      y += 12;
    }
    y += 5;
  };

  const formatTime = (value) => {
    if (!str(value)) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return str(value);
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true,
    }).format(date);
  };
  const formatDateTime = (value) => {
    if (!str(value)) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return str(value);
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(date);
  };

  gridSection("Referring and Receiving Facility Information", [
    ["Referring facility", referringFacility],
    ["Receiving facility (in-system route)", inSystemFacility],
    ["Referring facility address", referringFacilityAddress],
    ["Outside receiving facility", externalFacility],
    ["Receiving facility address (in-system)", receivingAddress],
    ["Outside facility address", externalAddress],
    ["Referring personnel", referringPersonnel],
    ["Assigned in-system recipient / role", [recipient, recipientRole, recipientStation].filter(Boolean).join(" · ")],
    ["Referring contact", referringContact],
    ["Destination service / clinic", destinationService],
    ["Outside recipient", externalRecipient],
    ["Outside recipient role / position", [externalRole, externalPosition].filter(Boolean).join(" · ")],
  ], 2);

  gridSection("Patient Information", [
    ["Patient name", patientName],
    ["Age", age ? `${age} years` : ""],
    ["Date of birth", birthDate ? formatDate(birthDate) : ""],
    ["Sex", sex],
    ["Complete address", address],
    ["Contact number", patientContact],
  ], 2);

  gridSection("Referral Details", [
    ["Referral number", referralNo],
    ["Referral date", referralDate ? formatDate(referralDate) : ""],
    ["Referral time", formatTime(createdAt)],
    ["Category", referralCategory],
    ["Priority", priority],
    ["Status", status],
    ["Scheduled appointment", formatDateTime(scheduledAt)],
    ["Laboratory test", laboratory],
  ], 2);

  sectionHeading("Clinical Information");
  paragraphField("Reason for referral", reason);
  paragraphField("Chief complaints", chiefComplaints);
  paragraphField("Clinical history", medicalHistory);
  paragraphField("Working impression", impression);
  if (physicalExamFindings) paragraphField("Previously recorded examination findings (barangay)", physicalExamFindings);
  paragraphField("RHU screening findings", encounter.findings);

  gridSection("Vital Signs", [
    ["Blood pressure", vitals.bp], ["Heart rate", vitals.hr ? `${vitals.hr} bpm` : ""],
    ["Respiratory rate", vitals.rr ? `${vitals.rr} /min` : ""], ["Oxygen saturation", vitals.o2sat ? `${vitals.o2sat}%` : ""],
    ["Temperature", vitals.temperature ? `${vitals.temperature} °C` : ""], ["Height", vitals.height ? `${vitals.height} cm` : ""],
    ["Weight", vitals.weight ? `${vitals.weight} kg` : ""], ["BMI", vitals.bmi],
  ], 3);
  paragraphField("Treatment given", treatmentGiven);
  paragraphField("Recommendations", recommendations);
  paragraphField("Additional notes", encounterNotes);

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
