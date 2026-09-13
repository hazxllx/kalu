import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import MedicalCertificateDocument from "@/features/certificates/components/MedicalCertificateDocument";

/**
 * Prints the formal A4 Medical Certificate via the browser print dialog.
 *
 * While a certificate is being printed, a copy of the document is portalled
 * to <body> (outside #root) and a print stylesheet is injected that:
 *   - hides every other body child (navigation, sidebars, modals, buttons),
 *   - shows only the portalled certificate,
 *   - forces A4 portrait with zero page margins so the document fits one page.
 *
 * The injected rules are removed again after the print dialog closes, so all
 * other print flows in the app are completely unaffected.
 */
export function useCertificatePrint() {
  const [printData, setPrintData] = useState(null);

  useEffect(() => {
    if (!printData) return undefined;

    const root = document.documentElement;
    root.classList.add("cert-printing");

    const style = document.createElement("style");
    style.textContent = `
      @media print {
        @page { size: A4 portrait; margin: 0; }
        html.cert-printing, html.cert-printing body { background: #fff !important; }
        html.cert-printing body > *:not(.cert-print-portal) { display: none !important; }
        html.cert-printing .cert-print-portal { display: block !important; }
        html.cert-printing .cert-print-portal .cert-doc { box-shadow: none !important; }
      }
    `;
    document.head.appendChild(style);

    // Give the portal a frame to settle before opening the dialog.
    const timer = window.setTimeout(() => window.print(), 80);

    const done = () => setPrintData(null);
    window.addEventListener("afterprint", done);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", done);
      style.remove();
      root.classList.remove("cert-printing");
    };
  }, [printData]);

  const portal = printData
    ? createPortal(
        <div className="cert-print-portal">
          <MedicalCertificateDocument
            certificate={printData.certificate}
            signatoryName={printData.signatoryName}
          />
        </div>,
        document.body
      )
    : null;

  const printCertificate = (certificate, signatoryName) =>
    setPrintData({ certificate, signatoryName });

  return { printCertificate, portal };
}

export default useCertificatePrint;
