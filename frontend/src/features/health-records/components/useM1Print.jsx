import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import M1PrintDocument from "./M1PrintDocument";
import { loadDocumentBranding } from "@/lib/documentBranding";

/**
 * Prints the FHSIS M1 report through the browser print dialog (which is also
 * how the PDF is produced — "Save as PDF").
 *
 * A print copy of the form is portalled to <body>, OUTSIDE the application
 * layout, and a print-only stylesheet is injected that hides every other body
 * child (sidebar, header, controls, modals) and shows only the form. This is
 * the same approach the Medical Certificate uses, and it is why the printed
 * output has no blank pages, no app chrome, and no duplicated content.
 *
 * The injected rules are removed after the dialog closes, so no other print
 * flow in the app is affected.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 8mm 10mm; }
  html.m1-printing, html.m1-printing body { background: #fff !important; }
  html.m1-printing body > *:not(.m1-print-portal) { display: none !important; }
  html.m1-printing .m1-print-portal { display: block !important; }
}
.m1-print-portal { display: none; }
`;

export function useM1Print() {
  const [payload, setPayload] = useState(null);
  const [brandingError, setBrandingError] = useState("");

  useEffect(() => {
    if (!payload) return undefined;

    const root = document.documentElement;
    root.classList.add("m1-printing");

    const style = document.createElement("style");
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);

    // Let the portal paint before opening the dialog.
    const timer = window.setTimeout(() => window.print(), 120);

    const done = () => setPayload(null);
    window.addEventListener("afterprint", done);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", done);
      style.remove();
      root.classList.remove("m1-printing");
    };
  }, [payload]);

  const portal = payload
    ? createPortal(
        <div className="m1-print-portal">
          <M1PrintDocument {...payload} />
        </div>,
        document.body,
      )
    : null;

  const startPrint = useCallback(async (data) => {
    setBrandingError("");
    try {
      const branding = await loadDocumentBranding("fhsis_m1");
      setPayload({ ...data, branding });
    } catch (error) {
      setBrandingError(error?.message || "Could not load official M1 branding.");
    }
  }, []);

  return { startPrint, portal, brandingError };
}

export default useM1Print;
