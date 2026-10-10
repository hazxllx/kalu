import { jsPDF } from "jspdf";

export const PAGE_W = 792;
export const PAGE_H = 612;
export const MARGIN = 18;
export const CONTENT_W = PAGE_W - 2 * MARGIN;
export const BOTTOM = PAGE_H - 34;

export const BLUE = [0, 51, 102];
export const SUBBAR = [173, 216, 230];
export const SUBINK = [0, 51, 102];
export const BORDER = [180, 180, 180];
export const INK = [0, 0, 0];
export const GRAY = [128, 128, 128];
export const WHITE = [255, 255, 255];

export const CELL_H = 14;
export const PAD = 3;
export const LINE_H = 7;

function rf(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function rt(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function rd(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function withX(parts) {
  let x = MARGIN;
  return parts.map((w) => {
    const result = [x, w];
    x += w;
    return result;
  });
}

function drawCell(doc, x, y, w, h, text, options = {}) {
  const { align = "left", bold = false, size = 7, fill = false, fillColor = WHITE, textColor = INK } = options;
  if (fill) {
    rf(doc, fillColor);
    doc.rect(x, y, w, h, "F");
  }
  rd(doc, BORDER);
  doc.rect(x, y, w, h, "S");
  rt(doc, textColor);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  const textY = y + h / 2 + size / 3;
  let textX = x + PAD;
  if (align === "center") {
    textX = x + w / 2;
  } else if (align === "right") {
    textX = x + w - PAD;
  }
  doc.text(String(text), textX, textY, { align: align === "right" ? "right" : align === "center" ? "center" : "left" });
}

function drawRow(doc, y, cols, data, options = {}) {
  const { heights = CELL_H, bold = false, size = 7, fill = false, fillColor = WHITE, textColor = INK, alignments = [] } = options;
  let x = MARGIN;
  for (let i = 0; i < cols.length; i++) {
    const w = cols[i];
    const val = data[i] !== undefined ? data[i] : "";
    const align = alignments[i] || "left";
    drawCell(doc, x, y, w, heights, val, { align, bold, size, fill, fillColor, textColor });
    x += w;
  }
  return y + heights;
}

function drawSectionHeader(doc, y, text) {
  rf(doc, BLUE);
  doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.rect(MARGIN, y, CONTENT_W, 14, "F");
  rt(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(text, MARGIN + 4, y + 10);
  return y + 14;
}

function drawSubHeader(doc, y, text) {
  rf(doc, SUBBAR);
  doc.setFillColor(SUBBAR[0], SUBBAR[1], SUBBAR[2]);
  doc.rect(MARGIN, y, CONTENT_W, 10, "F");
  rt(doc, SUBINK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(text, MARGIN + 3, y + 7);
  return y + 10;
}

function drawHeader(doc, model, branding) {
  rf(doc, BLUE);
  doc.rect(0, 0, PAGE_W, 28, "F");
  const municipalLogo = branding?.logos?.municipal;
  const rhuLogo = branding?.logos?.rhu;
  const addLogo = (logo, x) => {
    if (!logo?.dataUrl || !logo.width || !logo.height) return;
    const box = 22;
    const scale = Math.min(box / logo.width, box / logo.height);
    doc.addImage(logo.dataUrl, "PNG", x, 3, logo.width * scale, logo.height * scale);
  };
  addLogo(municipalLogo, 3);
  addLogo(rhuLogo, PAGE_W - 25);
  rt(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("FHSIS M1", PAGE_W / 2, 12, { align: "center" });
  doc.setFontSize(9);
  doc.text("Family Health Survey Individual Recording Form", PAGE_W / 2, 20, { align: "center" });
  rf(doc, WHITE);
  rt(doc, INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  let y = 32;
  doc.text("Name of BHS:", MARGIN, y);
  doc.text((model.meta && model.meta.bhs_name) || "________________________", MARGIN + 35, y);
  doc.text("Month:", MARGIN + 120, y);
  doc.text(model.month ? String(model.month).padStart(2, "0") : "____", MARGIN + 142, y);
  doc.text("Year:", MARGIN + 280, y);
  doc.text(String(model.year || "____"), MARGIN + 300, y);
  y += 7;
  doc.text("Barangay:", MARGIN, y);
  doc.text(model.barangay || "________________________", MARGIN + 28, y);
  doc.text("Municipality:", MARGIN + 400, y);
  doc.text((model.meta && model.meta.municipality) || "________________", MARGIN + 440, y);
  y += 7;
  doc.text("Province:", MARGIN, y);
  doc.text((model.meta && model.meta.province) || "____________________", MARGIN + 28, y);
  doc.text("Projected Population:", MARGIN + 180, y);
  doc.text(String((model.meta && model.meta.projected_population) || "_______"), MARGIN + 240, y);
  return y + 10;
}

function drawFooter(doc, pageNum, totalPages) {
  const y = PAGE_H - 20;
  rd(doc, BORDER);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  rt(doc, GRAY);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.text("Page " + pageNum + " of " + totalPages, PAGE_W / 2, y + 8, { align: "center" });
  if (pageNum === totalPages) {
    doc.setFontSize(7);
    doc.text("UpdatedJuly312025/narsannyeong", PAGE_W - MARGIN, y + 8, { align: "right" });
  }
}

function gv(model, code) {
  const v = model.getValue ? model.getValue(code) : 0;
  return v === undefined || v === null ? 0 : v;
}

function ga(model, code, key) {
  const d = model.getByAge ? model.getByAge(code) : null;
  if (!d) return 0;
  const v = d[key];
  return v === undefined || v === null ? 0 : v;
}

function gs(model, code, key) {
  const d = model.getBySex ? model.getBySex(code) : null;
  if (!d) return 0;
  const v = d[key];
  return v === undefined || v === null ? 0 : v;
}

function subBar(doc, y, text) {
  rf(doc, SUBBAR);
  doc.rect(MARGIN, y, CONTENT_W, 10, "F");
  rt(doc, SUBINK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(text, MARGIN + 3, y + 7);
  return y + 10;
}

function headerRow(doc, y, cols, labels) {
  let x = MARGIN;
  for (let i = 0; i < cols.length; i++) {
    drawCell(doc, x, y, cols[i], 10, labels[i], { align: "center", bold: true, size: 7, fill: true, fillColor: SUBBAR, textColor: SUBINK });
    x += cols[i];
  }
  return y + 10;
}

function indicatorRow(doc, y, cols, label, values, opts) {
  const o = opts || {};
  let x = MARGIN;
  drawCell(doc, x, y, cols[0], 10, label, { align: "left", size: 6, fill: !!o.fill, fillColor: o.fillColor || WHITE });
  x += cols[0];
  for (let i = 1; i < cols.length; i++) {
    drawCell(doc, x, y, cols[i], 10, values && values[i - 1] !== undefined ? values[i - 1] : "", { align: "center", size: 6, fill: !!o.fill, fillColor: o.fillColor || WHITE, bold: !!o.boldVals });
    x += cols[i];
  }
  return y + 10;
}

export function renderM1FhsisPdf(model, branding = null) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [PAGE_W, PAGE_H] });
  const TOTAL_PAGES = 9;
  let y = drawHeader(doc, model, branding);

  // ============= PAGE 1: Family Planning =============
  y = drawSectionHeader(doc, y, "SECTION A: FAMILY PLANNING");

  y = subBar(doc, y, "A1. Demand Satisfied");
  let dsCols = [220, 70, 70, 70, 70, 70];
  let x = MARGIN;
  y = headerRow(doc, y, dsCols, ["", "10-14", "15-19", "20-24", "25-29", "30-49"]);
  y = indicatorRow(doc, y, dsCols, "Total number of women of reproductive age (15-49) who are at risk of pregnancy", []);
  y = indicatorRow(doc, y, dsCols, "Total number of new and revisit acceptors", []);
  y = indicatorRow(doc, y, dsCols, "Total number of women who were provided with condoms", []);

  y += 5;
  y = subBar(doc, y, "A2. Family Planning Methods Provided");
  let fpCols = [200, 60, 60, 60, 60];
  y = headerRow(doc, y, fpCols, ["Method", "10-14", "15-19", "20-49", "Total"]);

  const fpMethods = [
    { code: "A2_btl", name: "BTL (Bilateral Tubal Ligation)" },
    { code: "A2_nsv", name: "NSV (No-Scalpel Vasectomy)" },
    { code: "A2_condom", name: "Condom (Male)" },
    { code: "A2_pop", name: "Pills (Progestogen Only)" },
    { code: "A2_coc", name: "Pills (Combined Oral Contraceptive)" },
    { code: "A2_dmpa", name: "Injectable (DMPA/Sayana Press)" },
    { code: "A2_implant", name: "Implant" },
    { code: "A2_iud_pp", name: "IUD (Postpartum)" },
    { code: "A2_iud_i", name: "IUD (Interval)" },
    { code: "A2_lam", name: "NFP - LAM (Lactational Amenorrhea Method)" },
    { code: "A2_bbt", name: "NFP - BBT (Basal Body Temperature)" },
    { code: "A2_cmm", name: "NFP - CMM (Cervical Mucus Method)" },
    { code: "A2_stm", name: "NFP - STM (Symptothermal Method)" },
    { code: "A2_sdm", name: "NFP - SDM (Standard Days Method)" },
  ];

  let rowFill = false;
  fpMethods.forEach(function(method) {
    const data = model.getByAge ? model.getByAge(method.code) : null;
    const d1014 = data ? (data["10-14"] || 0) : 0;
    const d1519 = data ? (data["15-19"] || 0) : 0;
    const d2049 = data ? (data["20-49"] || 0) : 0;
    const dTotal = data ? (data.Total || 0) : 0;
    y = indicatorRow(doc, y, fpCols, method.name, [d1014, d1519, d2049, dTotal], { fill: rowFill });
    rowFill = !rowFill;
  });

  y += 15;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  rt(doc, INK);
  doc.text("Prepared by: ________________________", MARGIN, y);
  doc.text("Reviewed by: ________________________", PAGE_W / 2, y);
  y += 10;
  doc.text("Date: ________________", MARGIN, y);
  doc.text("Date: ________________", PAGE_W / 2, y);

  drawFooter(doc, 1, TOTAL_PAGES);

  // ============= PAGE 2: Maternal Care =============
  doc.addPage();
  y = drawHeader(doc, model);
  y = drawSectionHeader(doc, y, "SECTION B: MATERNAL CARE");

  y += 3;
  y = subBar(doc, y, "B1. Prenatal Care");
  const prCols = [200, 35, 35, 35];
  y = headerRow(doc, y, prCols, ["Indicator", "1st", "2nd", "3rd"]);

  const prenatalItems = [
    "Total number of pregnant women for 1st prenatal visit",
    "Total number of pregnant women given TT1 / Td1",
    "Total number of pregnant women given TT2 / Td2",
    "Total number of pregnant women given TT3 / Td3",
    "Total number of pregnant women given TT4 / Td4",
    "Total number of pregnant women given TT5 / Td5",
    "Total number of pregnant women with 1st prenatal visit in 1st trimester",
    "Total number of pregnant women with complete TT/Td immunization",
    "Total number of pregnant women given iron supplement",
    "Total number of pregnant women given folic acid supplement",
    "Total number of pregnant women given calcium supplement",
    "Total number of pregnant women screened for blood pressure",
    "Total number of pregnant women screened for diabetes",
    "Total number of pregnant women screened for anemia",
    "Total number of high risk pregnant women identified"
  ];

  prenatalItems.forEach(function(item) {
    y = indicatorRow(doc, y, prCols, item, ["", "", ""]);
  });

  y += 10;
  y = subBar(doc, y, "B2. Intrapartum Care and Delivery Outcome");
  const b2Cols = [350, 100];
  y = headerRow(doc, y, b2Cols, ["Indicator", "Value"]);

  const b2Items = [
    "Total number of pregnant women who gave birth (live birth)",
    "Total number of births attended by skilled health personnel",
    "Total number of births delivered in health facility",
    "Total number of pregnant women given uterotonic before delivery",
    "Total number of pregnant women given oxytocin after delivery",
    "Total number of pregnant women with 4th vital sign checked (BP, PR, RR, Temp)",
    "Total number of postpartum women given 1st postpartum visit within 24 hours after delivery",
    "Total number of postpartum women given 2nd postpartum visit (3-7 days)",
    "Total number of postpartum women given 3rd postpartum visit (8-28 days)",
    "Total number of postpartum women screened for danger signs",
    "Total number of postpartum women with postpartum depression screened",
    "Total number of postpartum women given iron supplement",
    "Total number of postpartum women given folic acid supplement",
    "Total number of maternal deaths"
  ];

  b2Items.forEach(function(item) {
    y = indicatorRow(doc, y, b2Cols, item, [""]);
  });

  drawFooter(doc, 2, TOTAL_PAGES);

  // ============= PAGE 3: Postpartum and Child Care =============
  doc.addPage();
  y = drawHeader(doc, model);
  y = drawSectionHeader(doc, y, "SECTION B: MATERNAL CARE (continued)");

  y = subBar(doc, y, "B3. Postpartum");
  const b3Cols = [350, 100];
  y = headerRow(doc, y, b3Cols, ["Indicator", "Value"]);

  const b3Items = [
    "Total number of postpartum women with 4th postpartum visit (29-42 days)",
    "Total number of postpartum women provided with family planning counseling",
    "Total number of postpartum women provided with modern family planning method",
    "Total number of postpartum women who initiated breastfeeding within 1 hour after delivery",
    "Total number of postpartum women with exclusive breastfeeding at 6 months",
    "Total number of postpartum women given vitamin A supplement"
  ];

  b3Items.forEach(function(item) {
    y = indicatorRow(doc, y, b3Cols, item, [""]);
  });

  y += 10;
  y = drawSectionHeader(doc, y, "SECTION C: CHILD CARE");

  y = subBar(doc, y, "C1. Newborn Care");
  y = headerRow(doc, y, b3Cols, ["Indicator", "Value"]);

  const c1Items = [
    "Total number of live births",
    "Total number of newborns with birth weight less than 2500g (low birth weight)",
    "Total number of newborns with birth weight less than 2500g given early breastfeeding",
    "Total number of newborns with birth weight 2500g and above",
    "Total number of newborns with immediate breastfeeding within 1 hour after birth",
    "Total number of newborns who received BCG vaccine",
    "Total number of newborns who received Hepatitis B vaccine (birth dose)",
    "Total number of newborns with complete antenatal screening",
    "Total number of newborns with newborn screening (NBS)",
    "Total number of newborns with newborn hearing screening"
  ];

  c1Items.forEach(function(item) {
    y = indicatorRow(doc, y, b3Cols, item, [""]);
  });

  y = subBar(doc, y, "C2. Essential Newborn Care");
  y = headerRow(doc, y, b3Cols, ["Indicator", "Value"]);

  const c2Items = [
    "Total number of newborns with drying and skin-to-skin contact",
    "Total number of newborns with cord clamping after 1-3 minutes",
    "Total number of newborns with breastfeeding initiated within 1 hour",
    "Total number of newborns given vitamin K1",
    "Total number of newborns given eye prophylaxis"
  ];

  c2Items.forEach(function(item) {
    y = indicatorRow(doc, y, b3Cols, item, [""]);
  });

  drawFooter(doc, 3, TOTAL_PAGES);

  // ============= PAGE 4: Immunization =============
  doc.addPage();
  y = drawHeader(doc, model);
  y = drawSectionHeader(doc, y, "SECTION C: CHILD CARE");

  y = subBar(doc, y, "C1. Immunization (0-11 months)");
  const imm1Cols = [280, 60, 60, 60];
  y = headerRow(doc, y, imm1Cols, ["Indicator", "Male", "Female", "Total"]);

  const imm1Items = [
    "Total number of infants 0-11 months who received BCG",
    "Total number of infants 0-11 months who received HepB (birth dose)",
    "Total number of infants 0-11 months who received Pentavalent 1",
    "Total number of infants 0-11 months who received Pentavalent 2",
    "Total number of infants 0-11 months who received Pentavalent 3",
    "Total number of infants 0-11 months who received Oral Polio Vaccine 1 (OPV1)",
    "Total number of infants 0-11 months who received Oral Polio Vaccine 2 (OPV2)",
    "Total number of infants 0-11 months who received Oral Polio Vaccine 3 (OPV3)",
    "Total number of infants 0-11 months who received Inactivated Polio Vaccine (IPV)",
    "Total number of infants 0-11 months who received Measles Containing Vaccine (MCV1)",
    "Total number of infants 0-11 months who received MCV2",
    "Total number of fully immunized infants (FIC)"
  ];

  imm1Items.forEach(function(item) {
    y = indicatorRow(doc, y, imm1Cols, item, ["", "", ""]);
  });

  y += 10;
  y = subBar(doc, y, "C2. Immunization (12-23 months)");
  y = headerRow(doc, y, imm1Cols, ["Indicator", "Male", "Female", "Total"]);

  const imm2Items = [
    "Total number of children 12-23 months who received MMR/Measles containing vaccine",
    "Total number of children 12-23 months who received MMR2",
    "Total number of children 12-23 months who received booster doses (DPT, OPV, MMR)"
  ];

  imm2Items.forEach(function(item) {
    y = indicatorRow(doc, y, imm1Cols, item, ["", "", ""]);
  });

  y += 10;
  y = subBar(doc, y, "C3. Immunization (School Age Children)");
  y = headerRow(doc, y, imm1Cols, ["Indicator", "Male", "Female", "Total"]);

  const imm3Items = [
    "Total number of school children (7 years old) who received MMR",
    "Total number of school children (7 years old) who received Tetanus/Diphtheria (Td)",
    "Total number of school children given deworming tablet"
  ];

  imm3Items.forEach(function(item) {
    y = indicatorRow(doc, y, imm1Cols, item, ["", "", ""]);
  });

  y += 10;
  y = subBar(doc, y, "C4. Immunization (Pregnant Women)");
  y = headerRow(doc, y, imm1Cols, ["Indicator", "Male", "Female", "Total"]);

  const imm4Items = [
    "Total number of pregnant women given Tetanus Toxoid/Td (1st dose)",
    "Total number of pregnant women given Tetanus Toxoid/Td (2nd dose)",
    "Total number of pregnant women given Tetanus Toxoid/Td (3rd dose)",
    "Total number of pregnant women given Tetanus Toxoid/Td (4th dose)",
    "Total number of pregnant women given Tetanus Toxoid/Td (5th dose)"
  ];

  imm4Items.forEach(function(item) {
    y = indicatorRow(doc, y, imm1Cols, item, ["", "", ""]);
  });

  drawFooter(doc, 4, TOTAL_PAGES);

  // ============= PAGE 5: Nutrition and Sick Children =============
  doc.addPage();
  y = drawHeader(doc, model);
  y = drawSectionHeader(doc, y, "SECTION C: CHILD CARE (continued)");

  y = subBar(doc, y, "D1. Nutrition Indicators");
  const nutrCols = [280, 60, 60, 60];
  y = headerRow(doc, y, nutrCols, ["Indicator", "Male", "Female", "Total"]);

  const nutr1Items = [
    "Total number of children 0-59 months weighed",
    "Total number of children 0-59 months with weight taken",
    "Total number of children 0-59 months with normal weight for age",
    "Total number of children 0-59 months with mild malnutrition",
    "Total number of children 0-59 months with moderate malnutrition",
    "Total number of children 0-59 months with severe malnutrition",
    "Total number of children 6-59 months given Vitamin A (6-11 months)",
    "Total number of children 6-59 months given Vitamin A (12-59 months)",
    "Total number of children 0-59 months given MNP (Micronutrient Powder)",
    "Total number of children 6-59 months given deworming tablet"
  ];

  nutr1Items.forEach(function(item) {
    y = indicatorRow(doc, y, nutrCols, item, ["", "", ""]);
  });

  y += 10;
  y = subBar(doc, y, "D2. Management of Sick Children");
  const sickCols = [280, 60];
  y = headerRow(doc, y, sickCols, ["Indicator", "Value"]);

  const sickItems = [
    "Total number of children under 5 years with pneumonia treated with antibiotics",
    "Total number of children under 5 years with diarrhea given ORS and zinc",
    "Total number of children under 5 years with diarrhea given ORS",
    "Total number of children under 5 years referred for severe illness"
  ];

  sickItems.forEach(function(item) {
    y = indicatorRow(doc, y, sickCols, item, [""]);
  });

  y += 10;
  y = drawSectionHeader(doc, y, "SECTION D: ORAL HEALTH");

  y = subBar(doc, y, "D1. Oral Health Services");
  const oralCols = [350, 100];
  y = headerRow(doc, y, oralCols, ["Indicator", "Value"]);

  const oralItems = [
    "Total number of persons given oral health examination",
    "Total number of persons with oral health problems identified",
    "Total number of persons provided with dental health education",
    "Total number of persons provided with topical fluoride application",
    "Total number of persons provided with dental sealants",
    "Total number of toothache cases treated",
    "Total number of referrals to dental clinic"
  ];

  oralItems.forEach(function(item) {
    y = indicatorRow(doc, y, oralCols, item, [""]);
  });

  drawFooter(doc, 5, TOTAL_PAGES);

  // ============= PAGE 6: NCD =============
  doc.addPage();
  y = drawHeader(doc, model);
  y = drawSectionHeader(doc, y, "SECTION E: NON-COMMUNICABLE DISEASES");

  y = subBar(doc, y, "E1. Lifestyle Risk Factor Screening");
  const ncd1Cols = [280, 60, 60, 60];
  y = headerRow(doc, y, ncd1Cols, ["Indicator", "Male", "Female", "Total"]);

  const ncd1Items = [
    "Total number of adults screened for tobacco use",
    "Total number of adults screened for harmful alcohol use",
    "Total number of adults screened for physical inactivity",
    "Total number of adults screened for unhealthy diet"
  ];

  ncd1Items.forEach(function(item) {
    y = indicatorRow(doc, y, ncd1Cols, item, ["", "", ""]);
  });

  y += 5;
  y = subBar(doc, y, "E2. Cardiovascular Disease (CVD) Screening");
  y = headerRow(doc, y, ncd1Cols, ["Indicator", "Male", "Female", "Total"]);

  const ncd2Items = [
    "Total number of adults 20 years and above screened for hypertension (BP check)",
    "Total number of adults 20 years and above with BP >= 140/90 mmHg",
    "Total number of adults screened for diabetes (blood glucose)",
    "Total number of adults with blood glucose >= 126 mg/dL or previously diagnosed",
    "Total number of adults screened for dyslipidemia (cholesterol)",
    "Total number of adults with total cholesterol >= 200 mg/dL"
  ];

  ncd2Items.forEach(function(item) {
    y = indicatorRow(doc, y, ncd1Cols, item, ["", "", ""]);
  });

  y += 5;
  y = subBar(doc, y, "E3. Diabetes Mellitus");
  const ncd3Cols = [350, 100];
  y = headerRow(doc, y, ncd3Cols, ["Indicator", "Value"]);

  const ncd3Items = [
    "Total number of diabetic patients monitored for blood glucose",
    "Total number of diabetic patients with good glycemic control (HbA1c < 7%)",
    "Total number of diabetic patients referred to physician",
    "Total number of diabetic patients with foot examination",
    "Total number of diabetic patients with kidney disease (nephropathy)"
  ];

  ncd3Items.forEach(function(item) {
    y = indicatorRow(doc, y, ncd3Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "E4. Blindness Prevention");
  y = headerRow(doc, y, ncd3Cols, ["Indicator", "Value"]);

  const ncd4Items = [
    "Total number of adults screened for visual acuity",
    "Total number of adults with visual impairment",
    "Total number of persons referred for eye surgery",
    "Total number of cataract cases identified",
    "Total number of cataract surgeries performed"
  ];

  ncd4Items.forEach(function(item) {
    y = indicatorRow(doc, y, ncd3Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "E5. Immunization (Adult Immunization)");
  y = headerRow(doc, y, ncd1Cols, ["Indicator", "Male", "Female", "Total"]);

  const ncd5Items = [
    "Total number of adults given influenza vaccine",
    "Total number of adults given pneumococcal vaccine",
    "Total number of adults given hepatitis B vaccine",
    "Total number of adults given tetanus toxoid (Td)"
  ];

  ncd5Items.forEach(function(item) {
    y = indicatorRow(doc, y, ncd1Cols, item, ["", "", ""]);
  });

  y += 5;
  y = subBar(doc, y, "E6. Cancer Prevention");
  y = headerRow(doc, y, ncd3Cols, ["Indicator", "Value"]);

  const ncd6Items = [
    "Total number of women 25-30 years screened for cervical cancer (VIA)",
    "Total number of women 30-49 years screened for cervical cancer (HPV DNA)",
    "Total number of women with positive VIA/VIA screen referred for treatment",
    "Total number of women examined for breast cancer (clinical breast exam)",
    "Total number of women with breast mass referred for biopsy",
    "Total number of adults screened for oral cancer"
  ];

  ncd6Items.forEach(function(item) {
    y = indicatorRow(doc, y, ncd3Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "E7. Mental Health");
  y = headerRow(doc, y, ncd3Cols, ["Indicator", "Value"]);

  const ncd7Items = [
    "Total number of adults screened for mental health (PHQ-9)",
    "Total number of adults with depression (moderate to severe)",
    "Total number of adults with suicide risk screened",
    "Total number of adults with mental health disorders referred"
  ];

  ncd7Items.forEach(function(item) {
    y = indicatorRow(doc, y, ncd3Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "E8. Injury Prevention");
  y = headerRow(doc, y, ncd3Cols, ["Indicator", "Value"]);

  const ncd8Items = [
    "Total number of road traffic accidents reported",
    "Total number of injuries due to road traffic accidents",
    "Total number of cases of violence/abuse reported",
    "Total number of cases referred to social worker/hospital"
  ];

  ncd8Items.forEach(function(item) {
    y = indicatorRow(doc, y, ncd3Cols, item, [""]);
  });

  drawFooter(doc, 6, TOTAL_PAGES);

  // ============= PAGE 7: Environmental Health =============
  doc.addPage();
  y = drawHeader(doc, model);
  y = drawSectionHeader(doc, y, "SECTION F: ENVIRONMENTAL HEALTH");

  y = subBar(doc, y, "F1. Water Supply and Sanitation");
  const envCols = [350, 100];
  y = headerRow(doc, y, envCols, ["Indicator", "Value"]);

  const envItems = [
    "Total number of households with access to safe water supply (Level I)",
    "Total number of households with access to safe water supply (Level II)",
    "Total number of households with access to safe water supply (Level III)",
    "Total number of households with access to safe water supply (Level IV)",
    "Total number of households without access to safe water supply",
    "Total number of households with sanitary toilet",
    "Total number of households with unsanitary toilet",
    "Total number of households with no toilet",
    "Total number of households practicing proper garbage disposal",
    "Total number of households with complete basic sanitary facilities"
  ];

  envItems.forEach(function(item) {
    y = indicatorRow(doc, y, envCols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "F2. Food Safety and Vector Control");
  y = headerRow(doc, y, envCols, ["Indicator", "Value"]);

  const env2Items = [
    "Total number of food establishments inspected",
    "Total number of food handlers issued health certificates",
    "Total number of food poisoning cases reported",
    "Total number of households with vector control measures applied",
    "Total number of houses inspected for mosquito breeding sites"
  ];

  env2Items.forEach(function(item) {
    y = indicatorRow(doc, y, envCols, item, [""]);
  });

  drawFooter(doc, 7, TOTAL_PAGES);

  // ============= PAGE 8: Infectious Disease =============
  doc.addPage();
  y = drawHeader(doc, model);
  y = drawSectionHeader(doc, y, "SECTION G: INFECTIOUS DISEASES");

  y = subBar(doc, y, "G1. Filariasis");
  const inf1Cols = [350, 100];
  y = headerRow(doc, y, inf1Cols, ["Indicator", "Value"]);

  const inf1Items = [
    "Total number of persons screened for filariasis",
    "Total number of positive filariasis cases (microfilaria)",
    "Total number of filariasis cases given DEC treatment",
    "Total number of households given LF preventive chemotherapy"
  ];

  inf1Items.forEach(function(item) {
    y = indicatorRow(doc, y, inf1Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "G2. Rabies");
  y = headerRow(doc, y, inf1Cols, ["Indicator", "Value"]);

  const inf2Items = [
    "Total number of animal bite cases reported",
    "Total number of animal bite cases given rabies vaccine (Post-Exposure Prophylaxis)",
    "Total number of animal bite cases given rabies immunoglobulin (RIG)",
    "Total number of animal bite cases referred to animal bite center",
    "Total number of suspected rabid animals observed",
    "Total number of suspected rabid animals destroyed"
  ];

  inf2Items.forEach(function(item) {
    y = indicatorRow(doc, y, inf1Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "G3. Schistosomiasis");
  y = headerRow(doc, y, inf1Cols, ["Indicator", "Value"]);

  const inf3Items = [
    "Total number of persons screened for schistosomiasis",
    "Total number of positive schistosomiasis cases",
    "Total number of schistosomiasis cases treated",
    "Total number of households given Praziquantel"
  ];

  inf3Items.forEach(function(item) {
    y = indicatorRow(doc, y, inf1Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "G4. Soil-Transmitted Helminthiasis (STH)");
  y = headerRow(doc, y, inf1Cols, ["Indicator", "Value"]);

  const inf4Items = [
    "Total number of children 1-18 years screened for STH",
    "Total number of children 1-18 years positive for STH",
    "Total number of children 1-18 years given deworming tablet",
    "Total number of children 1-4 years given mebendazole",
    "Total number of children 5-9 years given mebendazole",
    "Total number of children 10-18 years given mebendazole"
  ];

  inf4Items.forEach(function(item) {
    y = indicatorRow(doc, y, inf1Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "G5. Leprosy");
  y = headerRow(doc, y, inf1Cols, ["Indicator", "Value"]);

  const inf5Items = [
    "Total number of new leprosy cases detected",
    "Total number of new leprosy cases among children",
    "Total number of multibacillary leprosy cases",
    "Total number of paucibacillary leprosy cases",
    "Total number of leprosy cases completed treatment",
    "Total number of leprosy cases with Grade 2 disability"
  ];

  inf5Items.forEach(function(item) {
    y = indicatorRow(doc, y, inf1Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "G6. HIV-AIDS and STI");
  y = headerRow(doc, y, inf1Cols, ["Indicator", "Value"]);

  const inf6Items = [
    "Total number of persons screened for HIV",
    "Total number of reactive HIV screening tests",
    "Total number of confirmed HIV positive cases",
    "Total number of PLHIV enrolled in HIV care",
    "Total number of PLHIV given antiretroviral therapy (ART)",
    "Total number of STI cases treated",
    "Total number of pregnant women screened for HIV",
    "Total number of HIV positive pregnant women given ARV prophylaxis",
    "Total number of exposed infants given ARV prophylaxis",
    "Total number of exposed infants tested for HIV"
  ];

  inf6Items.forEach(function(item) {
    y = indicatorRow(doc, y, inf1Cols, item, [""]);
  });

  drawFooter(doc, 8, TOTAL_PAGES);

  // ============= PAGE 9: Vital Statistics =============
  doc.addPage();
  y = drawHeader(doc, model);
  y = drawSectionHeader(doc, y, "SECTION H: VITAL STATISTICS");

  y = subBar(doc, y, "H1. Mortality");
  const vs1Cols = [280, 60, 60, 60];
  y = headerRow(doc, y, vs1Cols, ["Indicator", "Male", "Female", "Total"]);

  const vs1Items = [
    "Total number of deaths",
    "Total number of infant deaths (under 1 year)",
    "Total number of neonatal deaths (under 28 days)",
    "Total number of maternal deaths",
    "Total number of deaths due to infectious diseases",
    "Total number of deaths due to non-communicable diseases",
    "Total number of deaths due to injuries"
  ];

  vs1Items.forEach(function(item) {
    y = indicatorRow(doc, y, vs1Cols, item, ["", "", ""]);
  });

  y += 5;
  y = subBar(doc, y, "H2. Natality");
  const vs2Cols = [350, 100];
  y = headerRow(doc, y, vs2Cols, ["Indicator", "Value"]);

  const vs2Items = [
    "Total number of live births",
    "Total number of male live births",
    "Total number of female live births",
    "Total number of live births delivered in health facility",
    "Total number of live births attended by skilled health personnel",
    "Total number of teenage mothers (under 19 years)",
    "Total number of low birth weight newborns (less than 2500g)"
  ];

  vs2Items.forEach(function(item) {
    y = indicatorRow(doc, y, vs2Cols, item, [""]);
  });

  y += 5;
  y = subBar(doc, y, "H3. Infant Mortality");
  y = headerRow(doc, y, vs1Cols, ["Indicator", "Male", "Female", "Total"]);

  const vs3Items = [
    "Total number of infant deaths",
    "Total number of neonatal deaths",
    "Total number of postneonatal deaths",
    "Total number of infant deaths due to pneumonia",
    "Total number of infant deaths due to diarrhea",
    "Total number of infant deaths due to other causes"
  ];

  vs3Items.forEach(function(item) {
    y = indicatorRow(doc, y, vs1Cols, item, ["", "", ""]);
  });

  y += 5;
  y = subBar(doc, y, "H4. Teenage Pregnancy");
  const teenCols = [200, 60, 60, 60, 60];
  y = headerRow(doc, y, teenCols, ["Indicator", "10-14", "15-17", "18-19", "Total"]);

  const teenItems = [
    "Total number of pregnant teenagers",
    "Total number of teenage mothers who gave birth (live births)",
    "Total number of teenage mothers given prenatal care",
    "Total number of teenage mothers with 4 or more prenatal visits",
    "Total number of teenage mothers with postpartum visit",
    "Total number of teenage pregnancies with complications",
    "Total number of teenage pregnancies referred to hospital"
  ];

  teenItems.forEach(function(item) {
    y = indicatorRow(doc, y, teenCols, item, ["", "", "", ""]);
  });

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  rt(doc, INK);
  doc.text("Prepared by: ________________________    Signature: ________________________    Date: ________________", MARGIN, y);
  y += 12;
  doc.text("Reviewed by: ________________________    Signature: ________________________    Date: ________________", MARGIN, y);
  y += 12;
  doc.text("Approved by: ________________________    Signature: ________________________    Date: ________________", MARGIN, y);

  drawFooter(doc, 9, TOTAL_PAGES);

  return doc;
}
