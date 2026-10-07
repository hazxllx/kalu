import React from "react";

/**
 * Official A4 Medical Certificate document.
 *
 * Presentational only — renders the formal government/LGU document layout
 * used for BOTH the on-screen preview and the printed output:
 *
 *   [LGU logo]   Republic of the Philippines     [RHU logo]
 *                Province of [PROVINCE]
 *                LOCAL GOVERNMENT OF [MUNICIPALITY]
 *                OFFICE OF THE MUNICIPAL HEALTH OFFICER
 *                [ADDRESS / CONTACT]
 *
 *                MEDICAL CERTIFICATE
 *                ____________________
 *                              Date: ____________
 *
 *   Name: _______________  Age: ___  Sex: ___
 *   Status: _________  Address: _______________________
 *   Chief Complaint: ___________________________________
 *   Findings: (writing lines)
 *   Recommendation: (writing lines)
 *
 *   Issued upon the request of the interested party
 *   for purpose it may serve.
 *
 *                                    [AUTHORIZED SIGNATORY]
 *                                    Municipal Health Officer
 *                                    License No. __________
 *
 * All organization identity comes from the centralized branding payload
 * (Admin-configured logos + municipality/province/RHU/signatory). No
 * municipality, province, office, doctor or license is hardcoded — the
 * reference image (Pili / Camarines Sur / Dr. Salles) is an EXAMPLE ONLY.
 *
 * The document is intentionally NOT themed: an official certificate is always
 * black text on a white page in serif typography. Fill-in values are real
 * values displayed over thin printed rules; missing values render as blank
 * fill lines exactly like the paper form. No official seal, signature image or
 * personal data is invented or watermarked — the signature area is plain ruled
 * space for a handwritten signature, and the signatory identity is the
 * authoritative value stored with the certificate (or from the branding
 * configuration).
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** ISO "YYYY-MM-DD" → { monthDay, monthName, day, yy } */
const parseDate = (iso) => {
  if (!iso) return null;
  const value = String(iso || "").slice(0, 10);
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return {
    monthDay: `${MONTHS[m - 1]} ${d}`,
    monthName: MONTHS[m - 1],
    day: String(d),
    yy: String(y).slice(-2),
  };
};

/** Underlined fill-in field (thin printed rule, never a box). */
function Fill({ value, minWidth }) {
  return (
    <span className="cert-fill" style={minWidth ? { minWidth } : undefined}>
      {value || "\u00A0"}
    </span>
  );
}

/** Multi-line ruled writing lines (long values); blank rules when empty. */
function RuledText({ value, lines = 3 }) {
  const text = String(value || "").trim();
  if (text) {
    return (
      <p className="cert-underline" style={{ minHeight: `${lines * 4}mm` }}>
        {text}
      </p>
    );
  }
  return (
    <>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="cert-rule" />
      ))}
    </>
  );
}

export default function MedicalCertificateDocument({ certificate, signatoryName, branding }) {
  const c = certificate || {};
  const org = branding?.organization || {};
  const signatoryData = branding?.signatory || {};

  /**
   * Authorized signatory — the value stored on the issued certificate is
   * authoritative and does NOT change when branding is updated. When the
   * certificate is still a preview, the centralized branding signatory (the
   * active MHO's profile) is used as the intended signatory.
   */
  const signatory =
    String(c.medicalOfficer || signatoryName || signatoryData.fullName || "").trim() ||
    "Signatory name not set";
  const position =
    String(c.signatoryPosition || signatoryData.position || "").trim() ||
    "Municipal Health Officer";
  const licenseNumber = String(c.licenseNumber || signatoryData.licenseNumber || "").trim();

  const exam = parseDate(c.dateOfExamination);
  const issued = parseDate(c.issuedAt || c.dateIssued);

  // Organization government block — dynamic from centralized branding.
  const municipality = String(org.municipality || "").trim();
  const province = String(org.province || "").trim();
  const officeName = String(org.officeName || "OFFICE OF THE MUNICIPAL HEALTH OFFICER").trim();
  const addressLine = String(org.address || org.rhuAddress || "").trim();

  const patientAddress = String(c.address || "").trim();
  const statusValue = String(c.civilStatus || "").trim();
  const sexValue = String(c.sex || "").trim();
  const ageValue = c.age !== undefined && c.age !== null && c.age !== "" ? String(c.age).trim() : "";

  return (
    <div className="cert-doc" aria-label="Medical Certificate document">
      {/* Government header */}
      <header className="cert-header">
        <div className="cert-header-logo cert-header-logo-left">
          {branding?.logos?.municipal?.dataUrl && (
            <img
              src={branding.logos.municipal.dataUrl}
              alt="Municipality official logo"
              className="cert-logo-img"
            />
          )}
        </div>
        <div className="cert-header-govt">
          <p>Republic of the Philippines</p>
          <p>Province of {province || "________________________"}</p>
          <p className="cert-header-municipality">LOCAL GOVERNMENT OF {municipality || "______________________"}</p>
        </div>
        <div className="cert-header-logo cert-header-logo-right">
          {branding?.logos?.rhu?.dataUrl && (
            <img
              src={branding.logos.rhu.dataUrl}
              alt="Rural Health Unit official logo"
              className="cert-logo-img"
            />
          )}
        </div>
      </header>

      <div className="cert-office text-center">
        <p className="cert-office-name">{officeName}</p>
        {addressLine && <p className="cert-office-address">{addressLine}</p>}
      </div>

      {/* Divider under the office header */}
      <div className="mx-auto mt-2 w-full border-t border-black" />

      {/* Title */}
      <h1 className="cert-title">MEDICAL CERTIFICATE</h1>
      <div className="mx-auto mt-1 h-px w-[70mm] border-t border-black" />

      {/* Date — toward the right */}
      <div className="mt-6 text-right">
        <span>Date:&#8202;</span>
        <Fill value={issued ? `${issued.monthDay}, 20${issued.yy}` : ""} minWidth="40mm" />
      </div>

      {/* Patient information */}
      <div className="mt-6">
        <div className="cert-fieldline">
          <span className="cert-label">Name: </span>
          <Fill value={c.patient} minWidth="52mm" />
          <span className="cert-label cert-padleft">Age: </span>
          <Fill value={ageValue} minWidth="9mm" />
          <span className="cert-label cert-padleft">Sex: </span>
          <Fill value={sexValue} minWidth="10mm" />
        </div>

        <div className="cert-fieldline mt-3">
          <span className="cert-label">Status: </span>
          <Fill value={statusValue} minWidth="30mm" />
          <span className="cert-label cert-padleft">Address: </span>
          <Fill value={patientAddress} minWidth="78mm" />
        </div>

        <div className="cert-fieldline mt-3">
          <span className="cert-label">Chief Complaint: </span>
          <Fill value={c.chiefComplaint || c.remarks} minWidth="120mm" />
        </div>

        <div className="mt-4">
          <p className="cert-label cert-blocklabel">Findings:</p>
          <RuledText value={c.findings} lines={4} />
        </div>

        <div className="mt-3">
          <p className="cert-label cert-blocklabel">Recommendation:</p>
          <RuledText value={c.recommendation} lines={2} />
        </div>
      </div>

      {/* Certification statement */}
      <p className="cert-issuance">
        Issued upon the request of the interested party for purpose it may serve.
      </p>

      {/* Signature — lower right, generous whitespace above */}
      <div className="cert-signature">
        <div className="cert-signature-name">{signatory}</div>
        <div className="mx-auto w-[64mm] border-t border-black" />
        <p className="cert-signature-position">{position}</p>
        <p className="cert-signature-license">
          License No. <Fill value={licenseNumber} minWidth="22mm" />
        </p>
      </div>

      <p className="cert-meta">
        Reference: {c.certificateNumber || c.reference || ""}
        {c.dateIssued ? ` · Issued: ${String(c.dateIssued).slice(0, 10)}` : ""}
      </p>
    </div>
  );
}