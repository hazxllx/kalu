import React from "react";

/**
 * Official A4 Medical Certificate document (Municipality of Pili, Camarines Sur).
 *
 * Presentational only — renders the formal government-document layout used for
 * BOTH the on-screen preview and the printed output:
 *
 *   Government header → Office divider → No. (upper right) → title →
 *   certification text with fill-in fields → recommendation → remarks →
 *   issuance line → payment details (lower left) + signature (lower right).
 *
 * The document is intentionally NOT themed: an official certificate is always
 * black text on a white page in serif typography, in Light and Dark Mode
 * alike. Fill-in values are emphasized on ruled lines; missing values render
 * as blank fill lines exactly like the paper form. No official seal,
 * signature, or personal data is invented — the seal watermark and signature
 * mark are clearly-marked placeholders.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** ISO "YYYY-MM-DD" → { monthDay: "September 13", monthName: "September", day: "13", yy: "26" } */
const parseDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return {
    monthDay: `${MONTHS[m - 1]} ${d}`,
    monthName: MONTHS[m - 1],
    day: String(d),
    yy: String(y).slice(-2),
  };
};

/** Bordered, centered fill-in field (short values). */
function Fill({ value, minWidth }) {
  return (
    <span className="cert-fill" style={minWidth ? { minWidth } : undefined}>
      {value || "\u00A0"}
    </span>
  );
}

/** Multi-line ruled text (long values); blank rules when empty. */
function RuledText({ value, lines = 3 }) {
  if (value && value.trim()) {
    return (
      <p className="cert-underline" style={{ minHeight: `${lines * 4}mm` }}>
        {value}
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

export default function MedicalCertificateDocument({ certificate, signatoryName }) {
  const c = certificate || {};
  /**
   * Authorized signatory — the logged-in demo account's name (passed in from
   * the current session), falling back to the certificate's designated
   * medical officer. Never a placeholder like "Authorized Municipal Health
   * Officer"; when no name is available the explicit fallback below shows.
   */
  const signatory = String(signatoryName || c.medicalOfficer || "").trim() || "Demo Account Name Not Available";
  const exam = parseDate(c.dateOfExamination);
  const issued = parseDate(c.issuedAt || c.dateIssued);
  const payment = parseDate(c.paymentDate);

  return (
    <div className="cert-doc" aria-label="Medical Certificate document">
      {/* Subtle placeholder seal watermark (no official seal is reproduced). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        <div className="flex h-[68mm] w-[68mm] items-center justify-center rounded-full border border-black/10">
          <div className="flex h-[62mm] w-[62mm] flex-col items-center justify-center rounded-full border border-black/10 text-center">
            <p className="text-[7pt] font-semibold tracking-[0.25em] text-black/10">MUNICIPALITY OF PILI</p>
            <p className="mt-1 text-[6pt] text-black/10">OFFICIAL SEAL</p>
            <p className="text-[5.5pt] italic text-black/10">(placeholder)</p>
          </div>
        </div>
      </div>

      {/* Inner bordered page */}
      <div className="relative z-[1] flex min-h-[277mm] flex-col border border-black px-[11mm] py-[10mm]">
        {/* Government header */}
        <header className="text-center">
          <p>Republic of the Philippines</p>
          <p>Province of Camarines Sur</p>
          <p className="font-semibold">Municipality of Pili</p>
          <p className="my-1 text-[10pt] tracking-[0.3em]">-&nbsp;oOo&nbsp;-</p>
          <p className="text-[12pt] font-bold tracking-[0.06em]">OFFICE OF THE MUNICIPAL HEALTH OFFICER</p>
          <div className="mx-auto mt-1 w-full border-t border-black" />
        </header>

        {/* Certificate number (upper-right) */}
        <p className="mt-3 text-right">
          No. <Fill value={c.certificateNumber || c.reference} minWidth="42mm" />
        </p>

        {/* Title */}
        <h1 className="mt-4 text-center text-[16pt] font-bold tracking-[0.18em]">
          MEDICAL CERTIFICATE
        </h1>

        {/* Certification body */}
        <div className="mt-5 text-justify">
          <p>
            THIS IS TO CERTIFY that <Fill value={c.patient} minWidth="58mm" />
          </p>
          <p className="mt-0.5 text-center text-[8.5pt] italic">(Name of Patient)</p>
          <p className="mt-1">
            <Fill value={c.age !== undefined && c.age !== null && c.age !== "" ? String(c.age) : ""} minWidth="10mm" /> years of age,{" "}
            <Fill value={c.civilStatus} minWidth="24mm" /> civil status,
          </p>
          <p>
            a resident of <Fill value={c.barangay} minWidth="38mm" /> Barangay,
          </p>
          <p>Pili, Camarines Sur, has sought the services of this health center,</p>
          <p>
            and has been examined by the undersigned on{" "}
            <Fill value={exam ? exam.monthDay : ""} minWidth="30mm" />, 20
            <Fill value={exam ? exam.yy : ""} minWidth="8mm" />
          </p>
          <p>
            and diagnosed to be suffering from{" "}
            <span className={c.findings ? "cert-underline" : ""}>
              {c.findings || <span className="cert-fill" style={{ minWidth: "52mm" }}>&nbsp;</span>}
            </span>
            .
          </p>
        </div>

        {/* Recommendation */}
        <div className="mt-5">
          <p className="font-semibold">My recommendation:</p>
          <RuledText value={c.recommendation} lines={3} />
        </div>

        {/* Remarks */}
        <div className="mt-4">
          <p className="font-semibold">Remarks:</p>
          <RuledText value={c.remarks} lines={1} />
        </div>

        {/* Issuance */}
        <p className="mt-6">
          Issued this <Fill value={issued ? issued.day : ""} minWidth="10mm" /> day of{" "}
          <Fill value={issued ? issued.monthName : ""} minWidth="26mm" />, 20
          <Fill value={issued ? issued.yy : ""} minWidth="8mm" />
        </p>
        <p>at the Municipal Health Office of Pili, Camarines Sur.</p>

        {/* Payment (lower-left) + signature (lower-right) */}
        <div className="mt-auto flex items-end justify-between gap-10 pt-12">
          <div className="text-[10.5pt] leading-[2]">
            <p>
              O.R. No. <Fill value={c.orNumber} minWidth="30mm" />
            </p>
            <p>
              Amount: <Fill value={c.amount} minWidth="26mm" />
            </p>
            <p>
              Date: <Fill value={payment ? `${payment.monthDay} 20${payment.yy}` : ""} minWidth="30mm" />
            </p>
          </div>
          <div className="shrink-0 text-center">
            {/* Placeholder signature mark — no signature asset is reproduced. */}
            <p className="mb-1 text-[9pt] italic text-black/40">(Signature)</p>
            <div className="w-[64mm] border-t border-black" />
            <p className="mt-1.5 text-[11pt] font-semibold">{signatory}</p>
            <p className="text-[10pt]">Municipal Health Officer</p>
          </div>
        </div>
      </div>

      {/* Generation note (marks the document as KALUSAGAP-generated demo output) */}
      <p className="mt-1 text-center text-[6.5pt] text-black/50">
        Generated by KALUSAGAP — Community Health System (demo document)
      </p>
    </div>
  );
}
