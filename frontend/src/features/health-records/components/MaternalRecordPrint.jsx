import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const display = (value) => value === undefined || value === null || value === "" ? "—" : String(value);

function MaternalRecordDocument({ record }) {
  const date = new Date().toLocaleDateString();
  const periodEnd = record.deliveryDate || record.edd;
  const periodCovered = [record.lmp, periodEnd].filter(Boolean).join(" to ") || "—";
  const rows = [
    ["Last Menstrual Period", record.lmp, "", ""],
    ["Estimated Date of Delivery", record.edd, "", ""],
    ["Prenatal Visits", record.prenatalVisits, "", ""],
    ["Maternal Status", record.status, record.risk, ""],
    ["Date of Delivery", record.deliveryDate, record.deliveryOutcome, record.typeOfDelivery],
    ["Birth Weight", "", record.birthWeight, ""],
    ["Place of Delivery", "", record.placeOfDelivery, ""],
    ["Birth Attendant", "", record.birthAttendant, ""],
    ["Post-partum Check-up — Within 24 hours", record.ppCheckup24h, "", ""],
    ["Post-partum Check-up — Day 3", record.ppCheckupDay3, "", ""],
    ["Post-partum Check-up — 7–14 days", record.ppCheckup7to14d, "", ""],
    ["Post-partum Check-up — 6 weeks", record.ppCheckup6wk, "", ""],
    ["Iron/Folic Completed", record.ironFolicCompletedDate, "", ""],
    ["Vitamin A Given", record.vitaminAGivenDate, "", ""],
    ["Health / Lifestyle Profile", "", [
      record.smokingHistory ? "Smoking history" : "",
      record.bingeAlcohol ? "Binge alcohol" : "",
      record.insufficientPhysicalActivity ? "Insufficient physical activity" : "",
      record.unhealthyDiet ? "Unhealthy diet" : "",
    ].filter(Boolean).join("; "), ""],
    ["BMI (Asia Pacific Standard)", "", record.bmi, ""],
    ["Notes", "", record.notes, ""],
  ];

  return (
    <main className="maternal-print-document text-brand-ink">
      <header className="mb-4 border-b-2 border-brand-ink pb-3 text-center">
        <h1 className="font-heading text-xl font-bold">Maternal Record</h1>
        <p className="mt-1 text-sm">Prenatal, delivery and post-partum care</p>
      </header>

      <table className="mb-4 w-full border-collapse text-sm">
        <tbody>
          <tr>
            <th className="w-1/5 border border-brand-border px-2 py-1 text-left">Resident Name</th>
            <td className="border border-brand-border px-2 py-1">{display(record.residentName)}</td>
            <th className="w-1/5 border border-brand-border px-2 py-1 text-left">Record No.</th>
            <td className="border border-brand-border px-2 py-1">{display(record.id)}</td>
          </tr>
          <tr>
            <th className="border border-brand-border px-2 py-1 text-left">Period Covered</th>
            <td colSpan={3} className="border border-brand-border px-2 py-1">{periodCovered}</td>
          </tr>
        </tbody>
      </table>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {["Maternal Record Item", "Date", "Recorded Details", "Remarks"].map((label) => (
              <th key={label} className="border border-brand-ink px-2 py-1.5 text-left font-semibold">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, dateValue, details, remarks]) => (
            <tr key={label}>
              <th className="border border-brand-border px-2 py-1 text-left font-medium">{label}</th>
              <td className="border border-brand-border px-2 py-1">{display(dateValue)}</td>
              <td className="border border-brand-border px-2 py-1">{display(details)}</td>
              <td className="border border-brand-border px-2 py-1">{display(remarks)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="mt-8 grid grid-cols-3 gap-8 text-xs">
        <p>Prepared by: <span className="font-medium">{display(record.provider)}</span></p>
        <p>Verified by: —</p>
        <p>Date: {date}</p>
      </footer>
    </main>
  );
}

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  html.maternal-record-printing, html.maternal-record-printing body { background: #fff !important; }
  html.maternal-record-printing body > *:not(.maternal-record-print-portal) { display: none !important; }
  html.maternal-record-printing .maternal-record-print-portal { display: block !important; }
  .maternal-record-print-document { color: #000 !important; font-family: Arial, sans-serif !important; font-size: 10pt !important; }
  .maternal-record-print-document table, .maternal-record-print-document th, .maternal-record-print-document td {
    border-color: #000 !important; color: #000 !important;
  }
}
.maternal-record-print-portal { display: none; }
`;

export function useMaternalRecordPrint() {
  const [record, setRecord] = useState(null);

  useEffect(() => {
    if (!record) return undefined;
    const root = document.documentElement;
    root.classList.add("maternal-record-printing");
    const style = document.createElement("style");
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
    const timer = window.setTimeout(() => window.print(), 120);
    const done = () => setRecord(null);
    window.addEventListener("afterprint", done);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", done);
      style.remove();
      root.classList.remove("maternal-record-printing");
    };
  }, [record]);

  const portal = record
    ? createPortal(
        <div className="maternal-record-print-portal">
          <MaternalRecordDocument record={record} />
        </div>,
        document.body,
      )
    : null;

  const startPrint = useCallback((value) => setRecord(value), []);
  return { startPrint, portal };
}

export default MaternalRecordDocument;
