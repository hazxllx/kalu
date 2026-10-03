// __m1shot.jsx
import React2 from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";

// src/features/health-records/components/M1PrintDocument.jsx
import React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var CSS = `
.m1doc {
  box-sizing: border-box;
  width: 100%;
  background: #ffffff;
  color: #12263F;
  font-family: Arial, "Helvetica Neue", Helvetica, "Segoe UI", sans-serif;
  font-size: 9.5px;
  line-height: 1.15;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.m1doc * { box-sizing: border-box; }

/* ---------- identification header ---------- */
.m1doc .m1-head { text-align: center; margin: 0 0 4px; }
.m1doc .m1-title {
  margin: 0; font-size: 14px; font-weight: 700;
  letter-spacing: .3px; text-transform: uppercase; color: #072F5F;
}
.m1doc .m1-subtitle { margin: 1px 0 0; font-size: 10px; font-weight: 600; color: #12263F; }

.m1doc .m1-info { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 5px; }
.m1doc .m1-info th,
.m1doc .m1-info td {
  border: 1px solid #9AA8B8; padding: 1.5px 4px; font-size: 9px;
  vertical-align: top; text-align: left; overflow-wrap: anywhere;
}
.m1doc .m1-info th { width: 12%; background: #EEF3F9; color: #0B4A8F; font-weight: 700; }
.m1doc .m1-info td { width: 21.33%; }

/* ---------- section bars ---------- */
.m1doc .m1-section { margin: 0 0 5px; }
.m1doc .m1-section-head {
  background: #0B4A8F; color: #ffffff; font-size: 10.5px; font-weight: 700;
  letter-spacing: .4px; padding: 2.5px 6px;
  break-after: avoid; page-break-after: avoid; break-inside: avoid; page-break-inside: avoid;
}

/* ---------- indicator tables ---------- */
.m1doc .m1-block { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 4px; }
.m1doc .m1-block thead { display: table-header-group; }
.m1doc .m1-block.keep { break-inside: avoid; page-break-inside: avoid; }
.m1doc .m1-block.flow { break-inside: auto; page-break-inside: auto; }
.m1doc .m1-block th,
.m1doc .m1-block td {
  border: 1px solid #9AA8B8; padding: 1.5px 4px; font-size: 9.5px;
  vertical-align: top; overflow-wrap: anywhere; word-break: break-word;
}
.m1doc .m1-sub-head th {
  background: #DCE6F2; color: #0B4A8F; font-size: 9.5px; font-weight: 700;
  text-align: left; padding: 2px 6px;
  break-after: avoid; page-break-after: avoid;
}
.m1doc .m1-band th { background: #C7D6E8; color: #0B4A8F; font-size: 8.5px; font-weight: 700; text-align: center; padding: 1.5px 3px; }
.m1doc .m1-col-head th { background: #EEF3F9; color: #334155; font-size: 8.5px; font-weight: 700; text-align: center; padding: 1.5px 3px; }
.m1doc .m1-band th.m1-c-ind, .m1doc .m1-col-head th.m1-c-ind { text-align: left; }
.m1doc .m1-row { break-inside: avoid; page-break-inside: avoid; }
.m1doc .m1-row td { font-size: 9.5px; }
.m1doc .m1-c-code { text-align: center; white-space: nowrap; font-family: "Courier New", ui-monospace, monospace; font-size: 8.5px; color: #334155; }
.m1doc .m1-c-num { text-align: center; font-variant-numeric: tabular-nums; }
.m1doc .m1-c-total { text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.m1doc .m1-c-rem { font-size: 8.5px; color: #475569; }

/* ---------- side-by-side blocks ---------- */
.m1doc .m1-split {
  width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed;
  break-inside: avoid; page-break-inside: avoid; margin: 0 0 4px;
}
.m1doc .m1-split-cell { vertical-align: top; padding: 0; }
.m1doc .m1-split-cell:first-child { padding-right: 2px; }
.m1doc .m1-split-cell:last-child { padding-left: 2px; }
.m1doc .m1-split .m1-block { margin-bottom: 0; }

.m1doc .m1-empty { padding: 16px; text-align: center; font-size: 11px; color: #64748B; }

@media print {
  .m1doc { width: 100% !important; }
}
@page { size: A4 landscape; margin: 8mm 10mm; }
`;
var hasSex = (it) => Boolean(it?.sexBreakdown && it?.bySex);
var ageColsOf = (it) => Array.isArray(it?.ageGroups) && it.ageGroups.length > 1 ? it.ageGroups : [];
var colCount = (ageCols, sex) => 2 + ageCols.length + (sex ? 2 : 0) + 2;
var colWidths = (ageCols, sex) => {
  const w = [7, 34, ...ageCols.map(() => 8)];
  if (sex) w.push(7, 7);
  w.push(8, 20);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => `${(x / sum * 100).toFixed(3)}%`);
};
var splitBlocks = (subsection, items) => {
  const blocks = [];
  let cur = null;
  for (const it of items) {
    const ageCols = ageColsOf(it);
    const sex = hasSex(it);
    const sig = `${ageCols.join("|")}#${sex}`;
    if (!cur || cur.sig !== sig) {
      cur = { subsection, sig, ageCols, sex, items: [] };
      blocks.push(cur);
    }
    cur.items.push(it);
  }
  return blocks;
};
var isPairable = (b) => b.items.length <= 5 && colCount(b.ageCols, b.sex) <= 8;
function BlockTable({ block }) {
  const { subsection, ageCols, sex, items } = block;
  const cols = colCount(ageCols, sex);
  const widths = colWidths(ageCols, sex);
  const twoRow = ageCols.length > 0 || sex;
  const long = items.length >= 9;
  return /* @__PURE__ */ jsxs("table", { className: `m1-block ${long ? "flow" : "keep"}`, children: [
    /* @__PURE__ */ jsx("colgroup", { children: widths.map((w, i) => /* @__PURE__ */ jsx("col", { style: { width: w } }, i)) }),
    /* @__PURE__ */ jsxs("thead", { children: [
      /* @__PURE__ */ jsx("tr", { className: "m1-sub-head", children: /* @__PURE__ */ jsx("th", { colSpan: cols, children: subsection }) }),
      twoRow ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("tr", { className: "m1-band", children: [
          /* @__PURE__ */ jsx("th", { rowSpan: 2, children: "Code" }),
          /* @__PURE__ */ jsx("th", { rowSpan: 2, className: "m1-c-ind", children: "Indicator" }),
          ageCols.length ? /* @__PURE__ */ jsx("th", { colSpan: ageCols.length, children: "Age Group" }) : null,
          sex ? /* @__PURE__ */ jsx("th", { colSpan: 2, children: "Sex" }) : null,
          /* @__PURE__ */ jsx("th", { rowSpan: 2, children: "Total" }),
          /* @__PURE__ */ jsx("th", { rowSpan: 2, children: "Remarks" })
        ] }),
        /* @__PURE__ */ jsxs("tr", { className: "m1-col-head", children: [
          ageCols.map((a) => /* @__PURE__ */ jsx("th", { children: a }, a)),
          sex ? [/* @__PURE__ */ jsx("th", { children: "Male" }, "m"), /* @__PURE__ */ jsx("th", { children: "Female" }, "f")] : null
        ] })
      ] }) : /* @__PURE__ */ jsxs("tr", { className: "m1-col-head", children: [
        /* @__PURE__ */ jsx("th", { children: "Code" }),
        /* @__PURE__ */ jsx("th", { className: "m1-c-ind", children: "Indicator" }),
        /* @__PURE__ */ jsx("th", { children: "Total" }),
        /* @__PURE__ */ jsx("th", { children: "Remarks" })
      ] })
    ] }),
    /* @__PURE__ */ jsx("tbody", { children: items.map((it) => /* @__PURE__ */ jsxs("tr", { className: "m1-row", children: [
      /* @__PURE__ */ jsx("td", { className: "m1-c-code", children: it.code }),
      /* @__PURE__ */ jsx("td", { children: it.name }),
      ageCols.map((a) => /* @__PURE__ */ jsx("td", { className: "m1-c-num", children: it.byAge?.[a] ?? 0 }, a)),
      sex ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("td", { className: "m1-c-num", children: it.bySex?.Male ?? 0 }),
        /* @__PURE__ */ jsx("td", { className: "m1-c-num", children: it.bySex?.Female ?? 0 })
      ] }) : null,
      /* @__PURE__ */ jsx("td", { className: "m1-c-total", children: it.total ?? 0 }),
      /* @__PURE__ */ jsx("td", { className: "m1-c-rem", children: it.remarks || "" })
    ] }, it.code)) })
  ] });
}
function InfoRow({ cells }) {
  return /* @__PURE__ */ jsx("tr", { children: cells.map(([label, value]) => /* @__PURE__ */ jsxs(React.Fragment, { children: [
    /* @__PURE__ */ jsx("th", { scope: "row", children: label }),
    /* @__PURE__ */ jsx("td", { children: value === null || value === void 0 || value === "" ? "" : value })
  ] }, label)) });
}
function M1PrintDocument({ groups: groups2 = [], meta: meta2, periodLabel, barangay }) {
  const facility = meta2?.meta?.bhs_name || meta2?.barangay?.healthStation || "";
  const brgy = meta2?.barangay?.name || barangay || "";
  return /* @__PURE__ */ jsxs("div", { className: "m1doc", children: [
    /* @__PURE__ */ jsx("style", { children: CSS }),
    /* @__PURE__ */ jsxs("div", { className: "m1-head", children: [
      /* @__PURE__ */ jsx("p", { className: "m1-title", children: "FHSIS \u2014 MONTHLY FORM M1" }),
      /* @__PURE__ */ jsx("p", { className: "m1-subtitle", children: "Program Accomplishment / Service Coverage Report" })
    ] }),
    /* @__PURE__ */ jsx("table", { className: "m1-info", children: /* @__PURE__ */ jsxs("tbody", { children: [
      /* @__PURE__ */ jsx(InfoRow, { cells: [
        ["Reporting Period", periodLabel],
        ["Barangay", brgy],
        ["BHS / Facility", facility]
      ] }),
      /* @__PURE__ */ jsx(InfoRow, { cells: [
        ["Municipality/City", meta2?.municipality || ""],
        ["Province", meta2?.province || ""],
        ["Projected Population", meta2?.meta?.projected_population]
      ] }),
      /* @__PURE__ */ jsx(InfoRow, { cells: [
        ["Prepared by", meta2?.meta?.prepared_by || ""],
        ["Designation", meta2?.meta?.designation || ""],
        ["Validated by", meta2?.meta?.validated_by || ""]
      ] })
    ] }) }),
    !groups2.length ? /* @__PURE__ */ jsx("p", { className: "m1-empty", children: "No M1 indicators available for this reporting period." }) : groups2.map((g) => {
      const blocks = [];
      for (const sub of g.subsections) blocks.push(...splitBlocks(sub.subsection, sub.items));
      const rows2 = [];
      let i = 0;
      while (i < blocks.length) {
        const a = blocks[i];
        const b = blocks[i + 1];
        if (b && isPairable(a) && isPairable(b)) {
          rows2.push([a, b]);
          i += 2;
        } else {
          rows2.push([a]);
          i += 1;
        }
      }
      return /* @__PURE__ */ jsxs("section", { className: "m1-section", children: [
        /* @__PURE__ */ jsxs("div", { className: "m1-section-head", children: [
          "SECTION ",
          g.section,
          " \u2014 ",
          g.title
        ] }),
        rows2.map((pair, ri) => pair.length === 2 ? /* @__PURE__ */ jsx("table", { className: "m1-split", children: /* @__PURE__ */ jsx("tbody", { children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("td", { className: "m1-split-cell", children: /* @__PURE__ */ jsx(BlockTable, { block: pair[0] }) }),
          /* @__PURE__ */ jsx("td", { className: "m1-split-cell", children: /* @__PURE__ */ jsx(BlockTable, { block: pair[1] }) })
        ] }) }) }, `${g.section}-r${ri}`) : /* @__PURE__ */ jsx(BlockTable, { block: pair[0] }, `${g.section}-r${ri}`))
      ] }, g.section);
    })
  ] });
}

// ../backend/src/config/m1Catalog.js
var SECTIONS = Object.freeze([
  { key: "A", title: "Family Planning Services for Women of Reproductive Age" },
  { key: "B", title: "Maternal Care and Services" },
  { key: "C", title: "Child Care and Services" },
  { key: "D", title: "Oral Care and Services" },
  { key: "E", title: "Infectious Disease Prevention and Control Services" },
  { key: "F", title: "Non-Communicable Disease Prevention and Control" },
  { key: "G", title: "Environmental Health and Sanitation Services" },
  { key: "H", title: "Mortality and Natality" }
]);
var FREQUENCIES = Object.freeze(["monthly", "quarterly", "annual", "november"]);
var AGGREGATIONS = Object.freeze([
  "COUNT_UNIQUE_RESIDENTS",
  "COUNT_EVENTS",
  "COUNT_CASES",
  "SUM",
  "RATE",
  "PERCENTAGE",
  "CURRENT_USERS",
  "NEW_ACCEPTORS",
  "DROPOUTS",
  "TOTAL"
]);
var SOURCES = Object.freeze([
  "m1_records",
  // dedicated underlying-event store (public.m1_records)
  "immunizations",
  // reuse public.immunizations
  "households",
  // reuse public.households WASH fields
  "household_member_health_profiles",
  // reuse mortality fields
  "maternal_records"
  // reuse public.maternal_records
]);
var AGE_SCHEMES = Object.freeze({
  none: ["Total"],
  fp: ["10-14", "15-19", "20-49"],
  // women of reproductive age bands
  malaria: ["<5", ">=5"],
  deworming_child: ["1-4", "5-9", "10-19"],
  mortality_detail: [
    "0-6 days",
    "7-28 days",
    "29 days-11 months",
    "1-4",
    "5-9",
    "10-14",
    "15-19",
    "20-24",
    "25-29",
    "30-34",
    "35-39",
    "40-44",
    "45-49",
    "50-54",
    "55-59",
    "60-64",
    "65-69",
    "70+"
  ]
});
var FP_MEASURES = Object.freeze([
  { key: "current_begin", label: "Current Users \u2014 Beginning of Month" },
  { key: "new_prev", label: "New Acceptors \u2014 Previous Month" },
  { key: "other_present", label: "Other Acceptors \u2014 Present Month" },
  { key: "dropout_present", label: "Drop-outs \u2014 Present Month" },
  { key: "new_present", label: "New Acceptors \u2014 Present Month" },
  { key: "current_end", label: "Current Users \u2014 End of Month" }
]);
var ORDER = 0;
var rows = [];
var ind = (section, subsection, code, name, opts = {}) => {
  const {
    frequency = "monthly",
    aggregation = "TOTAL",
    source = "m1_records",
    ageScheme = "none",
    sex = false,
    remarks = true,
    dataType = "count",
    match = null,
    // adapter hint for non-m1_records sources
    population = null
  } = opts;
  rows.push({
    code,
    section,
    subsection,
    name,
    frequency,
    aggregation,
    source,
    ageScheme,
    ageGroups: AGE_SCHEMES[ageScheme] || AGE_SCHEMES.none,
    sexBreakdown: Boolean(sex),
    remarksAllowed: Boolean(remarks),
    dataType,
    match,
    population,
    displayOrder: ORDER += 10,
    active: true
  });
};
ind(
  "A",
  "A1. Modern FP Unmet Need",
  "A1_1",
  "Women of reproductive age with unmet need for modern family planning",
  { ageScheme: "fp", aggregation: "COUNT_UNIQUE_RESIDENTS" }
);
var FP_METHODS = [
  ["A2_btl", "Female Sterilization / BTL"],
  ["A2_nsv", "Male Sterilization / NSV"],
  ["A2_condom", "Condom"],
  ["A2_pop", "Pills \u2014 POP"],
  ["A2_coc", "Pills \u2014 COC"],
  ["A2_dmpa", "Injectables \u2014 DMPA/POI"],
  ["A2_implant", "Implant"],
  ["A2_iud_i", "IUD \u2014 Interval (IUD-I)"],
  ["A2_iud_pp", "IUD \u2014 Post-Partum (IUD-PP)"],
  ["A2_lam", "NFP \u2014 LAM"],
  ["A2_bbt", "NFP \u2014 BBT"],
  ["A2_cmm", "NFP \u2014 CMM"],
  ["A2_stm", "NFP \u2014 STM"],
  ["A2_sdm", "NFP \u2014 SDM"]
];
for (const [code, name] of FP_METHODS) {
  ind("A", "A2. Use of Family Planning Method", code, name, {
    ageScheme: "fp",
    aggregation: "CURRENT_USERS",
    dataType: "fp_method"
  });
}
ind(
  "A",
  "A2. Use of Family Planning Method",
  "A2_total",
  "Total Current Users (all methods, End of Month)",
  { ageScheme: "fp", aggregation: "CURRENT_USERS", dataType: "fp_total" }
);
ind(
  "A",
  "A3. Deworming (WRA)",
  "A3_1",
  "Women 20-49 years old given 2 doses of deworming drugs",
  { aggregation: "COUNT_UNIQUE_RESIDENTS", population: "20-49 F" }
);
var B1 = "B1. Prenatal Care";
ind("B", B1, "B1_1", "Pregnant women with at least 4 prenatal check-ups", { ageScheme: "fp" });
ind("B", B1, "B1_2", "Pregnant women assessed for nutritional status during the first trimester", { ageScheme: "fp" });
ind("B", B1, "B1_2a", "First-trimester pregnant women with normal BMI", { ageScheme: "fp" });
ind("B", B1, "B1_2b", "First-trimester pregnant women with low BMI", { ageScheme: "fp" });
ind("B", B1, "B1_2c", "First-trimester pregnant women with high BMI", { ageScheme: "fp" });
ind("B", B1, "B1_3", "Pregnant women (first time) given at least 2 doses of Td", { ageScheme: "fp" });
ind("B", B1, "B1_4", "Pregnant women (second+) given at least 3 doses of Td / Td2 Plus", { ageScheme: "fp" });
ind("B", B1, "B1_5", "Pregnant women who completed iron with folic acid supplementation", { ageScheme: "fp" });
ind("B", B1, "B1_6", "Pregnant women who completed calcium carbonate supplementation", { ageScheme: "fp" });
ind("B", B1, "B1_7", "Pregnant women given iodine capsules", { ageScheme: "fp" });
ind("B", B1, "B1_8", "Pregnant women given one dose of deworming tablet", { ageScheme: "fp" });
ind("B", B1, "B1_9", "Pregnant women screened for syphilis", { ageScheme: "fp" });
ind("B", B1, "B1_10", "Pregnant women tested positive for syphilis", { ageScheme: "fp", aggregation: "COUNT_CASES" });
ind("B", B1, "B1_11", "Pregnant women screened for Hepatitis B", { ageScheme: "fp" });
ind("B", B1, "B1_12", "Pregnant women tested positive for Hepatitis B", { ageScheme: "fp", aggregation: "COUNT_CASES" });
ind("B", B1, "B1_13", "Pregnant women screened for HIV", { ageScheme: "fp" });
ind("B", B1, "B1_14", "Pregnant women tested for CBC or Hgb/Hct count", { ageScheme: "fp" });
ind("B", B1, "B1_15", "Pregnant women tested for CBC or Hgb/Hct diagnosed with anemia", { ageScheme: "fp", aggregation: "COUNT_CASES" });
ind("B", B1, "B1_16", "Pregnant women screened for gestational diabetes", { ageScheme: "fp" });
ind("B", B1, "B1_17", "Pregnant women tested positive for gestational diabetes", { ageScheme: "fp", aggregation: "COUNT_CASES" });
var B2 = "B2. Intrapartum Care and Delivery Outcome";
ind("B", B2, "B2_18", "Number of deliveries", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_19", "Number of live births", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_20a", "Live births with normal birth weight", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_20b", "Live births with low birth weight", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_20c", "Live births with unknown birth weight", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_21", "Deliveries attended by skilled health professionals", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_21a", "Deliveries attended by a Doctor", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_21b", "Deliveries attended by a Nurse", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_21c", "Deliveries attended by a Midwife", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_22", "Deliveries attended by non-skilled health professionals", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_22a", "Deliveries attended by Hilot/TBA", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_22b", "Deliveries attended by others", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_23", "Health facility-based deliveries", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_24a", "Deliveries in a public health facility", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_24b", "Deliveries in a private health facility", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_25", "Non-facility-based deliveries", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_26a", "Vaginal deliveries", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_26b", "Deliveries by cesarean section", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_27a", "Full-term births", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_27b", "Pre-term births", { aggregation: "COUNT_EVENTS" });
ind("B", B2, "B2_27c", "Fetal deaths", { aggregation: "COUNT_CASES" });
ind("B", B2, "B2_27d", "Abortion / miscarriage", { aggregation: "COUNT_CASES" });
var B3 = "B3. Postpartum and Newborn Care";
ind("B", B3, "B3_28", "Postpartum women + newborn who completed at least 2 postpartum check-ups", { ageScheme: "fp" });
ind("B", B3, "B3_29", "Postpartum women who completed iron with folic acid supplementation", { ageScheme: "fp" });
ind("B", B3, "B3_30", "Postpartum women with Vitamin A supplementation", { ageScheme: "fp" });
var C1 = "C1. Immunization Services";
var VAX = [
  ["C1_1", "CPAB", ["CPAB"]],
  ["C1_2", "BCG", ["BCG"]],
  ["C1_3", "HepB within 24 hours", ["HepB", "Hepatitis B", "HEPB"]],
  ["C1_4", "DPT-Hib-HepB (Penta) 1", ["Penta 1", "Pentavalent 1", "DPT-Hib-HepB 1"]],
  ["C1_5", "DPT-Hib-HepB (Penta) 2", ["Penta 2", "Pentavalent 2", "DPT-Hib-HepB 2"]],
  ["C1_6", "DPT-Hib-HepB (Penta) 3", ["Penta 3", "Pentavalent 3", "DPT-Hib-HepB 3"]],
  ["C1_7", "OPV 1", ["OPV 1", "OPV1"]],
  ["C1_8", "OPV 2", ["OPV 2", "OPV2"]],
  ["C1_9", "OPV 3", ["OPV 3", "OPV3"]],
  ["C1_10", "IPV", ["IPV"]],
  ["C1_11", "PCV 1", ["PCV 1", "PCV1"]],
  ["C1_12", "PCV 2", ["PCV 2", "PCV2"]],
  ["C1_13", "MCV 1", ["MCV 1", "MCV1", "AMV", "Measles"]],
  ["C1_14", "MCV 2", ["MCV 2", "MCV2", "MMR"]],
  ["C1_15", "FIC (Fully Immunized Child)", ["FIC"]],
  ["C1_16", "CIC (Completely Immunized Child)", ["CIC"]]
];
for (const [code, name, aliases] of VAX) {
  ind("C", C1, code, name, {
    source: "immunizations",
    aggregation: "COUNT_EVENTS",
    sex: true,
    match: { vaccine: name, aliases, status: "Completed" }
  });
}
ind("C", C1, "C1_17", "Td, Grade 1 (November)", { source: "immunizations", frequency: "november", sex: true, aggregation: "COUNT_EVENTS", match: { vaccine: "Td Grade 1", aliases: ["Td Grade 1", "Td G1"], status: "Completed" } });
ind("C", C1, "C1_18", "MR, Grade 1 (November)", { source: "immunizations", frequency: "november", sex: true, aggregation: "COUNT_EVENTS", match: { vaccine: "MR Grade 1", aliases: ["MR Grade 1", "MR G1"], status: "Completed" } });
ind("C", C1, "C1_19", "Td, Grade 7 (November)", { source: "immunizations", frequency: "november", sex: true, aggregation: "COUNT_EVENTS", match: { vaccine: "Td Grade 7", aliases: ["Td Grade 7", "Td G7"], status: "Completed" } });
ind("C", C1, "C1_20", "MR, Grade 7 (November)", { source: "immunizations", frequency: "november", sex: true, aggregation: "COUNT_EVENTS", match: { vaccine: "MR Grade 7", aliases: ["MR Grade 7", "MR G7"], status: "Completed" } });
var C2 = "C2. Nutrition Services";
var nutri = (code, name) => ind("C", C2, code, name, { sex: true, aggregation: "COUNT_EVENTS" });
nutri("C2_21", "Newborns initiated on breastfeeding within 90 minutes of birth");
nutri("C2_22", "Preterm/LBW infants given iron supplementation");
nutri("C2_23", "Infants 6 months old seen");
nutri("C2_24", "Infants exclusively breastfed until the 6th month");
nutri("C2_25", "Infants 6 months initiated to complementary feeding WITH continued breastfeeding");
nutri("C2_26", "Infants 6 months initiated to complementary feeding, no longer/never breastfed");
nutri("C2_27", "Infants 6-11 months old seen");
nutri("C2_28", "Infants 6-11 months given 1 dose Vitamin A 100,000 IU");
nutri("C2_29", "Children 12-59 months old seen");
nutri("C2_30", "Children 12-59 months given 2 doses Vitamin A 200,000 IU");
nutri("C2_31", "Infants 6-11 months who completed MNP supplementation");
nutri("C2_32", "Children 12-23 months old seen");
nutri("C2_33", "Children 12-23 months who completed MNP supplementation");
var CNS = "C2b. Child Nutritional Status";
ind("C", CNS, "C2_status_mam", "Children with Moderate Acute Malnutrition (MAM)", { sex: true, aggregation: "COUNT_CASES", dataType: "nutrition_status" });
ind("C", CNS, "C2_status_sam", "Children with Severe Acute Malnutrition (SAM)", { sex: true, aggregation: "COUNT_CASES", dataType: "nutrition_status" });
ind("C", CNS, "C2_status_overweight", "Children Overweight/Obese", { sex: true, aggregation: "COUNT_CASES", dataType: "nutrition_status" });
ind("C", CNS, "C2_status_normal", "Children with Normal nutritional status", { sex: true, aggregation: "COUNT_CASES", dataType: "nutrition_status" });
var C3 = "C3. Deworming Services (Children/Adolescents)";
ind("C", C3, "C3_35", "1-19 year olds given 2 doses of deworming drug", { sex: true, aggregation: "COUNT_EVENTS" });
ind("C", C3, "C3_35a", "PSAC 1-4 years old dewormed with 2 doses", { sex: true, aggregation: "COUNT_EVENTS" });
ind("C", C3, "C3_35b", "SAC 5-9 years old dewormed with 2 doses", { sex: true, aggregation: "COUNT_EVENTS" });
ind("C", C3, "C3_35c", "Adolescents 10-19 years old dewormed with 2 doses", { sex: true, aggregation: "COUNT_EVENTS" });
var C4 = "C4. Management of Sick Infants and Children";
ind("C", C4, "C4_36", "Sick infants 6-11 months old seen", { sex: true, aggregation: "COUNT_EVENTS" });
ind("C", C4, "C4_37", "Sick infants 6-11 months old who received Vitamin A", { sex: true, aggregation: "COUNT_EVENTS" });
ind("C", C4, "C4_38", "Sick children 12-59 months old seen", { sex: true, aggregation: "COUNT_EVENTS" });
ind("C", C4, "C4_39", "Sick children 12-59 months old who received Vitamin A", { sex: true, aggregation: "COUNT_EVENTS" });
ind("C", C4, "C4_40", "Diarrhea cases 0-59 months old seen", { sex: true, aggregation: "COUNT_CASES" });
ind("C", C4, "C4_41", "Diarrhea cases 0-59 months old who received ORS", { sex: true, aggregation: "COUNT_CASES" });
ind("C", C4, "C4_42", "Diarrhea cases 0-59 months old who received ORS with zinc", { sex: true, aggregation: "COUNT_CASES" });
ind("C", C4, "C4_43", "Pneumonia cases 0-59 months old seen", { sex: true, aggregation: "COUNT_CASES" });
ind("C", C4, "C4_44", "Pneumonia cases 0-59 months old who completed treatment", { sex: true, aggregation: "COUNT_CASES" });
var D = "D. Oral Care and Services";
var oral = (code, name) => ind("D", D, code, name, { frequency: "quarterly", sex: true, aggregation: "COUNT_EVENTS" });
oral("D_1", "Children 12-59 months orally fit upon examination or after rehabilitation");
oral("D_2", "Clients 5 years old and above with DMFT (Decayed-Missing-Filled Teeth)");
oral("D_3", "Infants 0-11 months who received Basic Oral Health Care (BOHC)");
oral("D_4", "Children 1-4 years old who received BOHC");
oral("D_5", "Children 5-9 years old who received BOHC");
oral("D_6", "Adolescents 10-14 years old who received BOHC");
oral("D_7", "Adolescents 15-19 years old who received BOHC");
oral("D_8", "Adults 20-59 years old who received BOHC");
oral("D_9", "Senior citizens 60 years old and above who received BOHC");
oral("D_10", "Pregnant women who received BOHC");
ind("E", "E1. Filariasis", "E1_1", "Filariasis cases/mass drug administration (annual)", { frequency: "annual", aggregation: "COUNT_CASES", sex: true });
var E2 = "E2. Schistosomiasis";
ind("E", E2, "E2_1", "Patients seen", { aggregation: "COUNT_EVENTS" });
ind("E", E2, "E2_2", "Suspected cases seen", { aggregation: "COUNT_CASES" });
ind("E", E2, "E2_3", "Acute clinically diagnosed cases", { aggregation: "COUNT_CASES" });
ind("E", E2, "E2_4", "Confirmed acute cases", { aggregation: "COUNT_CASES" });
ind("E", E2, "E2_5", "Chronic clinically diagnosed cases", { aggregation: "COUNT_CASES" });
ind("E", E2, "E2_6", "Confirmed chronic cases", { aggregation: "COUNT_CASES" });
ind("E", E2, "E2_7", "Confirmed cases (acute and chronic)", { aggregation: "COUNT_CASES" });
ind("E", E2, "E2_8", "Cases treated", { aggregation: "COUNT_CASES" });
ind("E", E2, "E2_9", "Confirmed chronic cases referred to a hospital facility", { aggregation: "COUNT_CASES" });
var E5 = "E5. Tuberculosis";
ind("E", E5, "E5_1", "Notified TB cases, all forms", { aggregation: "COUNT_CASES", sex: true });
ind("E", E5, "E5_2", "Registered bacteriologically-confirmed DR-TB / RR-MDR-TB cases", { aggregation: "COUNT_CASES", sex: true });
ind("E", E5, "E5_3", "TB (all forms) cured and completely treated", { aggregation: "COUNT_CASES", sex: true });
ind("E", E5, "E5_4", "DR-TB / RR-MDR-TB cases cured and completed treatment", { aggregation: "COUNT_CASES", sex: true });
var E6 = "E6. Malaria";
ind("E", E6, "E6_1", "Probable/clinically-diagnosed malaria and confirmed cases", { aggregation: "COUNT_CASES", ageScheme: "malaria", sex: true });
ind("E", E6, "E6_2", "Laboratory-confirmed malaria deaths", { aggregation: "COUNT_CASES", ageScheme: "malaria", sex: true });
var E7 = "E7. Leprosy";
ind("E", E7, "E7_1", "Leprosy cases on treatment during the reporting period", { aggregation: "COUNT_CASES", sex: true });
ind("E", E7, "E7_2", "Newly detected leprosy cases during the reporting period", { aggregation: "COUNT_CASES", sex: true });
var E8 = "E8. Rabies";
ind("E", E8, "E8_1", "Animal bite cases", { aggregation: "COUNT_CASES", sex: true });
ind("E", E8, "E8_2", "Deaths due to rabies", { aggregation: "COUNT_CASES", sex: true });
var F = "F. NCD Prevention and Control";
ind("F", F, "F_1", "Adults risk-assessed using the NCD risk-assessment protocol", { aggregation: "COUNT_UNIQUE_RESIDENTS", sex: true });
ind("F", F, "F_2", "Current smokers", { aggregation: "COUNT_CASES", sex: true });
ind("F", F, "F_3", "Alcohol binge drinkers", { aggregation: "COUNT_CASES", sex: true });
ind("F", F, "F_4", "Overweight/Obese", { aggregation: "COUNT_CASES", sex: true });
ind("F", F, "F_5", "Adult women screened for cervical cancer (VIA/Pap smear/approved method)", { aggregation: "COUNT_UNIQUE_RESIDENTS" });
ind("F", F, "F_6", "Adult women found positive/suspect for cervical cancer", { aggregation: "COUNT_CASES" });
ind("F", F, "F_7", "Adult women screened for breast mass", { aggregation: "COUNT_UNIQUE_RESIDENTS" });
ind("F", F, "F_8", "Adult women with suspicious breast mass", { aggregation: "COUNT_CASES" });
ind("F", F, "F_9", "Newly identified hypertensive adults", { aggregation: "COUNT_CASES", sex: true });
ind("F", F, "F_10", "Newly identified adults with Type 2 Diabetes Mellitus", { aggregation: "COUNT_CASES", sex: true });
ind("F", F, "F_11", "Senior citizens screened for visual acuity", { aggregation: "COUNT_UNIQUE_RESIDENTS", sex: true });
ind("F", F, "F_12", "Senior citizens diagnosed with eye disease(s)", { aggregation: "COUNT_CASES", sex: true });
ind("F", F, "F_13", "Senior citizens who received one dose of PPV", { aggregation: "COUNT_EVENTS", sex: true });
ind("F", F, "F_14", "Senior citizens who received one dose of influenza vaccine", { aggregation: "COUNT_EVENTS", sex: true });
var G = "G. Environmental Health and Sanitation";
var HH = "households";
ind("G", G, "G_1", "Households with access to basic safe water supply", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "water_source", in: ["level1", "level2", "level3"] } });
ind("G", G, "G_1_1", "Households with Level I water supply", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "water_source", eq: "level1" } });
ind("G", G, "G_1_2", "Households with Level II water supply", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "water_source", eq: "level2" } });
ind("G", G, "G_1_3", "Households with Level III water supply", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "water_source", eq: "level3" } });
ind("G", G, "G_2", "Households using safely managed drinking-water services", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "water_treated", eq: true, and: { field: "water_source", in: ["level1", "level2", "level3"] } } });
ind("G", G, "G_3", "Households with a basic sanitation facility", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "toilet_type", in: ["ws_own", "ws_shared", "antipolo"] } });
ind("G", G, "G_3_1", "Households with pour/flush toilet connected to septic tank", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "toilet_type", eq: "ws_own" } });
ind("G", G, "G_3_2", "Households with pour/flush toilet connected to a sewer/approved treatment", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "toilet_type", eq: "ws_shared" } });
ind("G", G, "G_3_3", "Households with a ventilated improved pit (VIP) latrine", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "toilet_type", eq: "antipolo" } });
ind("G", G, "G_4", "Households using safely managed sanitation services", { source: HH, aggregation: "COUNT_UNIQUE_RESIDENTS", dataType: "household", match: { field: "toilet_type", eq: "ws_own" } });
ind("G", G, "G_5", "Industrial establishments issued with a sanitary permit", { aggregation: "COUNT_EVENTS", dataType: "establishment" });
ind("G", G, "G_6", "Barangays declared Zero Open Defecation (ZOD)", { aggregation: "COUNT_EVENTS", frequency: "annual", dataType: "establishment" });
var H1 = "H1. Mortality";
ind("H", H1, "H1_1", "Total deaths", { source: "household_member_health_profiles", aggregation: "COUNT_EVENTS", sex: true });
ind("H", H1, "H1_2", "Maternal deaths", { aggregation: "COUNT_CASES" });
ind("H", H1, "H1_3", "Under-five deaths", { aggregation: "COUNT_CASES", sex: true });
ind("H", H1, "H1_4", "Infant deaths", { aggregation: "COUNT_CASES", sex: true });
ind("H", H1, "H1_5", "Neonatal deaths", { aggregation: "COUNT_CASES", sex: true });
ind("H", H1, "H1_6", "Fetal deaths", { aggregation: "COUNT_CASES", sex: true });
ind("H", H1, "H1_7", "Early neonatal deaths", { aggregation: "COUNT_CASES", sex: true });
ind("H", H1, "H1_8", "Perinatal deaths", { aggregation: "COUNT_CASES", sex: true });
ind("H", H1, "H1_detail", "Mortality by underlying cause (ICD-10)", { aggregation: "COUNT_CASES", ageScheme: "mortality_detail", sex: true, dataType: "mortality_detail" });
var H2 = "H2. Natality";
ind("H", H2, "H2_1", "Live births (by mother's age group)", { aggregation: "COUNT_EVENTS", ageScheme: "fp" });
var M1_INDICATORS = Object.freeze(rows.map((r) => Object.freeze(r)));
var BY_CODE = new Map(M1_INDICATORS.map((r) => [r.code, r]));
var indicatorsBySection = (sectionKey) => M1_INDICATORS.filter((r) => r.section === sectionKey);
var catalogTree = () => {
  return SECTIONS.map((s) => {
    const items = indicatorsBySection(s.key);
    const subMap = /* @__PURE__ */ new Map();
    for (const it of items) {
      if (!subMap.has(it.subsection)) subMap.set(it.subsection, []);
      subMap.get(it.subsection).push(it);
    }
    return {
      section: s.key,
      title: s.title,
      subsections: [...subMap.entries()].map(([subsection, indicators]) => ({ subsection, indicators }))
    };
  });
};

// __m1shot.jsx
var TITLES = {
  A: "Family Planning Services",
  B: "Maternal Care and Services",
  C: "Child Care and Services",
  D: "Oral Care and Services",
  E: "Infectious Disease Prevention & Control",
  F: "Non-Communicable Disease Prevention & Control",
  G: "Environmental Health and Sanitation",
  H: "Mortality and Natality"
};
var groups = catalogTree().map((s) => ({
  section: s.section,
  title: TITLES[s.section] || s.title,
  subsections: s.subsections.map((sub) => ({
    subsection: sub.subsection,
    items: sub.indicators.map((ind2, i) => ({
      code: ind2.code,
      name: ind2.name,
      total: i % 5 + 1,
      sexBreakdown: ind2.sexBreakdown,
      bySex: ind2.sexBreakdown ? { Male: i % 3, Female: i % 4 + 1, Other: 0, Unknown: 0 } : null,
      ageGroups: ind2.ageGroups,
      byAge: Object.fromEntries((ind2.ageGroups || []).map((g, j) => [g, (i + j) % 4])),
      remarks: i % 7 === 0 ? `Sample remark for ${ind2.code}` : ""
    }))
  }))
}));
var meta = {
  barangay: { name: "Barangay San Jose", healthStation: "San Jose BHS" },
  municipality: "Pili",
  province: "Camarines Sur",
  meta: { projected_population: 15420, prepared_by: "Maria Santos, RN", designation: "Public Health Nurse", validated_by: "Dr. J. Dela Cruz, MHO" }
};
var html = renderToStaticMarkup(
  React2.createElement(M1PrintDocument, { groups, meta, periodLabel: "January 2026", barangay: "Barangay San Jose" })
);
var doc = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff">${html}</body></html>`;
fs.writeFileSync(process.argv[2], doc, "utf8");
console.log("WROTE", process.argv[2], "sections=", groups.length, "rows=", groups.reduce((n, g) => n + g.subsections.reduce((m, s) => m + s.items.length, 0), 0));
