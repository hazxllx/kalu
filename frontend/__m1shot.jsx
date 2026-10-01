import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import M1PrintDocument from "./src/features/health-records/components/M1PrintDocument.jsx";
import { catalogTree } from "../backend/src/config/m1Catalog.js";

const TITLES = {
  A: "Family Planning Services",
  B: "Maternal Care and Services",
  C: "Child Care and Services",
  D: "Oral Care and Services",
  E: "Infectious Disease Prevention & Control",
  F: "Non-Communicable Disease Prevention & Control",
  G: "Environmental Health and Sanitation",
  H: "Mortality and Natality",
};

const groups = catalogTree().map((s) => ({
  section: s.section,
  title: TITLES[s.section] || s.title,
  subsections: s.subsections.map((sub) => ({
    subsection: sub.subsection,
    items: sub.indicators.map((ind, i) => ({
      code: ind.code,
      name: ind.name,
      total: (i % 5) + 1,
      sexBreakdown: ind.sexBreakdown,
      bySex: ind.sexBreakdown ? { Male: i % 3, Female: (i % 4) + 1, Other: 0, Unknown: 0 } : null,
      ageGroups: ind.ageGroups,
      byAge: Object.fromEntries((ind.ageGroups || []).map((g, j) => [g, (i + j) % 4])),
      remarks: i % 7 === 0 ? `Sample remark for ${ind.code}` : "",
    })),
  })),
}));

const meta = {
  barangay: { name: "Barangay San Jose", healthStation: "San Jose BHS" },
  municipality: "Pili",
  province: "Camarines Sur",
  meta: { projected_population: 15420, prepared_by: "Maria Santos, RN", designation: "Public Health Nurse", validated_by: "Dr. J. Dela Cruz, MHO" },
};

const html = renderToStaticMarkup(
  React.createElement(M1PrintDocument, { groups, meta, periodLabel: "January 2026", barangay: "Barangay San Jose" }),
);

const doc = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff">${html}</body></html>`;
fs.writeFileSync(process.argv[2], doc, "utf8");
console.log("WROTE", process.argv[2], "sections=", groups.length, "rows=", groups.reduce((n, g) => n + g.subsections.reduce((m, s) => m + s.items.length, 0), 0));
