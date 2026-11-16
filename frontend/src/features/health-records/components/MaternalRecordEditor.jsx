import React, { useState, useEffect } from "react";
import { X, CheckCircle2, Pencil, Trash2, Printer, Calendar, Baby } from "lucide-react";
import { Card } from "@/components/common/Card";
import { ButtonSelectGroup as SelectButtonGroup } from "@/components/system";
import StatusBadge from "@/components/common/StatusBadge";

const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/20";
const selectCls = `${inputCls} cursor-pointer`;
const textareaCls = `${inputCls} resize-none`;

const yesNoLabel = (value) => value == null ? "Not recorded" : value ? "Yes" : "No";

const DELIVERY_TYPES = [
  { value: "Vaginal", label: "Vaginal" },
  { value: "Cesarean", label: "Cesarean" },
];

const DELIVERY_OUTCOMES = [
  { value: "Live Birth", label: "Live Birth" },
  { value: "Fetal Death", label: "Fetal Death" },
];

const DELIVERY_PLACES = [
  { value: "Public Facility", label: "Public Facility" },
  { value: "Private Facility", label: "Private Facility" },
  { value: "Home / Non-Facility", label: "Home / Non-Facility" },
];

const BIRTH_ATTENDANTS = [
  { value: "Doctor", label: "Doctor" },
  { value: "Nurse", label: "Nurse" },
  { value: "Midwife", label: "Midwife" },
  { value: "Hilot/TBA", label: "Hilot/TBA" },
  { value: "Other", label: "Other" },
];

const BIRTH_WEIGHT_CLASSES = [
  { value: "low", label: "Low (< 2,500 g)" },
  { value: "normal", label: "Normal (≥ 2,500 g)" },
  { value: "unknown", label: "Unknown" },
];

const PREGNANCY_OUTCOMES = [
  { value: "FT", label: "FT - Full Term" },
  { value: "PT", label: "PT - Pre-term" },
  { value: "FD", label: "FD - Fetal Death" },
  { value: "AB", label: "AB - Abortion/Miscarriage" },
];

const NEWBORN_SEX = [
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
];

const RISK_LEVELS = ["Low", "Moderate", "High"];
const STATUSES = ["Active", "Delivered", "Transferred", "Inactive"];
const SES_OPTS = [
  { value: "", label: "Not Specified" },
  { value: "NHTS", label: "1 - NHTS" },
  { value: "Non-NHTS", label: "2 - Non-NHTS" },
];

// Screening result options with clinically appropriate labels
// Values preserved for backward compatibility with existing database records
const SYPHILIS_RESULTS = [
  { value: "+", label: "Reactive" },
  { value: "-", label: "Non-reactive" },
];

const HEPATITIS_B_RESULTS = [
  { value: "+", label: "Reactive" },
  { value: "-", label: "Non-reactive" },
];

const GDM_RESULTS = [
  { value: "+", label: "Positive" },
  { value: "-", label: "Negative" },
];

const CBC_RESULTS = [
  { value: "+", label: "Anemia detected" },
  { value: "-", label: "No anemia detected" },
];

/**
 * MaternalRecordEditor — Unified read-only / edit-mode maternal record viewer
 * 
 * When editing, ALL sections become editable with proper input controls.
 * When saving, updates the complete maternal record in the database.
 */
function MaternalRecordEditor({
  detail,
  onClose,
  onDelete,
  onPrint,
  onEditMode,
  onRecordEncounter,
  onRecordDelivery,
  onRecordPostpartum,
  visitLoadError,
  saving,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [activeSection, setActiveSection] = useState("overview");

  useEffect(() => {
    if (detail && !form) {
      setForm({
        // Pregnancy Information
        lmp: detail.lmp || "",
        edd: detail.edd || "",
        prenatalVisits: detail.prenatalVisits || 0,
        status: detail.status || "Active",
        provider: detail.provider || "",
        dateOfRegistration: detail.dateOfRegistration || "",
        familySerialNo: detail.familySerialNo || "",
        socioEconomicStatus: detail.socioEconomicStatus || "",
        gravida: detail.gravida !== null ? detail.gravida : "",
        para: detail.para !== null ? detail.para : "",
        risk: detail.risk || "Low",

        // Prenatal Services & Screening
        td1Date: detail.td1Date || "",
        td2Date: detail.td2Date || "",
        td3Date: detail.td3Date || "",
        td4Date: detail.td4Date || "",
        td5Date: detail.td5Date || "",
        fimStatus: detail.fimStatus == null ? "" : String(detail.fimStatus),
        prenatalIronFolicTablets: detail.prenatalIronFolicTablets ?? "",
        calciumTablets: detail.calciumTablets ?? "",
        iodineGivenDate: detail.iodineGivenDate || "",
        dewormingDate: detail.dewormingDate || "",
        syphilisScreenDate: detail.syphilisScreenDate || "",
        syphilisResult: detail.syphilisResult || "",
        hepbScreenDate: detail.hepbScreenDate || "",
        hepbResult: detail.hepbResult || "",
        hivScreenDate: detail.hivScreenDate || "",
        gdmScreenDate: detail.gdmScreenDate || "",
        gdmResult: detail.gdmResult || "",
        cbcScreenDate: detail.cbcScreenDate || "",
        cbcResult: detail.cbcResult || "",
        cbcIronGiven: detail.cbcIronGiven == null ? "" : String(detail.cbcIronGiven),

        // Delivery Information
        deliveryDate: detail.deliveryDate || "",
        deliveryTime: detail.deliveryTime || "",
        deliveryOutcome: detail.deliveryOutcome || "",
        typeOfDelivery: detail.typeOfDelivery || "",
        placeOfDelivery: detail.placeOfDelivery || "",
        birthAttendant: detail.birthAttendant || "",
        birthWeight: detail.birthWeight || "",
        birthWeightClass: detail.birthWeightClass || "",
        pregnancyOutcome: detail.pregnancyOutcome || "",
        pregnancyOutcomeDate: detail.pregnancyOutcomeDate || "",
        newbornSex: detail.newbornSex || "",

        // Postpartum Care
        ppCheckup24h: detail.ppCheckup24h || "",
        ppCheckupDay3: detail.ppCheckupDay3 || "",
        ppCheckup7to14d: detail.ppCheckup7to14d || "",
        ppCheckup6wk: detail.ppCheckup6wk || "",
        ironFolicCompletedDate: detail.ironFolicCompletedDate || "",
        vitaminAGivenDate: detail.vitaminAGivenDate || "",

        // Maternal Health & Lifestyle
        smokingHistory: detail.smokingHistory == null ? "" : String(detail.smokingHistory),
        bingeAlcohol: detail.bingeAlcohol == null ? "" : String(detail.bingeAlcohol),
        insufficientPhysicalActivity: detail.insufficientPhysicalActivity == null ? "" : String(detail.insufficientPhysicalActivity),
        unhealthyDiet: detail.unhealthyDiet == null ? "" : String(detail.unhealthyDiet),
        bmi: detail.bmi || "",
        notes: detail.notes || "",
      });
    }
  }, [detail, form]);

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const calculateEDD = () => {
    if (!form?.lmp) return detail?.edd || "—";
    const lmp = new Date(form.lmp);
    const edd = new Date(lmp.getTime() + 280 * 24 * 60 * 60 * 1000);
    return edd.toISOString().split("T")[0];
  };

  const calculateBMI = () => {
    const w = Number(detail?.latestWeightKg);
    const h = Number(detail?.latestHeightCm);
    if (w && h && h > 0) {
      const heightM = h / 100;
      return (w / (heightM * heightM)).toFixed(1);
    }
    return detail?.bmi ? String(detail.bmi) : "Not available";
  };

  const handleSave = async () => {
    // Validation
    const next = {};
    if (Number(form.prenatalVisits) < 0) next.prenatalVisits = "Must be 0 or greater";
    if (form.gravida !== "" && Number(form.gravida) < 0) next.gravida = "Must be 0 or greater";
    if (form.para !== "" && Number(form.para) < 0) next.para = "Must be 0 or greater";
    if (form.birthWeight && Number(form.birthWeight) < 0) next.birthWeight = "Must be greater than 0";
    if (form.bmi && Number(form.bmi) < 0) next.bmi = "Must be greater than 0";

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    // Call parent handler to save
    onEditMode?.({
      ...form,
      prenatalVisits: Number(form.prenatalVisits) || 0,
      gravida: form.gravida === "" ? null : Number(form.gravida),
      para: form.para === "" ? null : Number(form.para),
      birthWeight: form.birthWeight === "" ? "" : String(form.birthWeight),
      bmi: calculateBMI() === "Not available" ? (detail.bmi || null) : Number(calculateBMI()),
    });

    setIsEditing(false);
  };

  const handleCancel = () => {
    setForm(null);
    setIsEditing(false);
  };

  if (!detail || !form) return null;

  const edd = isEditing ? calculateEDD() : (detail.edd || "—");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl !p-0 shadow-2xl max-h-[90vh]">
        {/* Fixed Header */}
        <div className="border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-semibold text-gray-900">{detail.residentName}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {isEditing ? "Edit Maternal Record" : "Maternal Record"}
                {detail.barangay ? ` • ${detail.barangay}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <StatusBadge value={detail.risk} />
              <button
                onClick={onClose}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-3">
            <nav aria-label="Maternal record sections" className="flex gap-2 overflow-x-auto">
              {[
                ["overview", "Overview"],
                ["prenatal", "Prenatal Services & Screening"],
                ["delivery", "Delivery Information"],
                ["postpartum", "Postpartum Care"],
                ["lifestyle", "Maternal Health & Lifestyle Profile"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-current={activeSection === key ? "page" : undefined}
                  onClick={() => setActiveSection(key)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    activeSection === key ? "bg-brand-blue text-white" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
          <div className="px-6 py-5 space-y-6">
            {/* Quick Summary */}
            {!isEditing && activeSection === "overview" && (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5 text-center">
                  {[
                    ["LMP", detail.lmp || "—"],
                    ["EDD", detail.edd || "—"],
                    ["Visits", detail.prenatalVisits || "0"],
                    ["Status", detail.status || "—"],
                    ["Provider", detail.provider || "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
                    </div>
                  ))}
                </div>
                <hr className="border-gray-200" />
              </>
            )}

            {/* Section A: Pregnancy Information */}
            <section className={activeSection === "overview" ? "" : "hidden"}>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Pregnancy Information</h3>
              <div className="grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-8">
                {isEditing ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Date of Registration</label>
                      <input type="date" value={form.dateOfRegistration} onChange={(e) => set("dateOfRegistration")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Last Menstrual Period (LMP)</label>
                      <input type="date" value={form.lmp} onChange={(e) => set("lmp")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Expected Delivery Date (EDD)</label>
                      <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600">{edd}</div>
                      <p className="mt-1 text-xs text-gray-500">Auto-calculated from LMP</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Prenatal Visits</label>
                      <input type="number" min={0} value={form.prenatalVisits} onChange={(e) => set("prenatalVisits")(e.target.value)} className={inputCls} />
                      {errors.prenatalVisits && <p className="mt-1 text-xs text-brand-danger">{errors.prenatalVisits}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Gravida (G)</label>
                      <input type="number" min={0} value={form.gravida} onChange={(e) => set("gravida")(e.target.value)} placeholder="Total pregnancies" className={inputCls} />
                      {errors.gravida && <p className="mt-1 text-xs text-brand-danger">{errors.gravida}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Para (P)</label>
                      <input type="number" min={0} value={form.para} onChange={(e) => set("para")(e.target.value)} placeholder="Term/preterm births" className={inputCls} />
                      {errors.para && <p className="mt-1 text-xs text-brand-danger">{errors.para}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Risk Classification</label>
                      <select value={form.risk} onChange={(e) => set("risk")(e.target.value)} className={selectCls}>
                        {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                      <select value={form.status} onChange={(e) => set("status")(e.target.value)} className={selectCls}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Provider</label>
                      <input type="text" value={form.provider} onChange={(e) => set("provider")(e.target.value)} placeholder="e.g. Midwife" className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Family Serial Number</label>
                      <input type="text" value={form.familySerialNo} onChange={(e) => set("familySerialNo")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Socio-Economic Status</label>
                      <select value={form.socioEconomicStatus} onChange={(e) => set("socioEconomicStatus")(e.target.value)} className={selectCls}>
                        {SES_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    {[
                      ["Date of Registration", detail.dateOfRegistration || "Not recorded"],
                      ["LMP", detail.lmp || "Not recorded"],
                      ["EDD", detail.edd || "Not recorded"],
                      ["Gravida (G)", detail.gravida !== null && detail.gravida !== "" ? detail.gravida : "Not recorded"],
                      ["Para (P)", detail.para !== null && detail.para !== "" ? detail.para : "Not recorded"],
                      ["Risk Classification", detail.risk || "Not recorded"],
                      ["Socio-Economic Status", detail.socioEconomicStatus || "Not specified"],
                      ["Family Serial Number", detail.familySerialNo || "Not recorded"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
                        <p className="mt-1 text-sm text-gray-900">{value}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

            {activeSection === "overview" && <hr className="border-gray-200" />}

            {/* Section B: Prenatal Services & Screening (Abbreviated for space) */}
            <section className={activeSection === "prenatal" ? "" : "hidden"}>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Prenatal Services & Screening</h3>
              <div className="grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-8">
                {isEditing ? (
                  <>
                    {["td1Date", "td2Date", "td3Date", "td4Date", "td5Date"].map((key, i) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Td{i + 1} / TT{i + 1}</label>
                        <input type="date" value={form[key]} onChange={(e) => set(key)(e.target.value)} className={inputCls} />
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">FIM Status</label>
                      <select aria-label="FIM Status" value={form.fimStatus} onChange={(e) => set("fimStatus")(e.target.value)} className={selectCls}>
                        <option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Iron + Folic Acid (tablets)</label>
                      <input type="number" min={0} value={form.prenatalIronFolicTablets} onChange={(e) => set("prenatalIronFolicTablets")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Calcium Tablets</label>
                      <input type="number" min={0} value={form.calciumTablets} onChange={(e) => set("calciumTablets")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Iodine Capsules Date</label>
                      <input type="date" value={form.iodineGivenDate} onChange={(e) => set("iodineGivenDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Deworming Date</label>
                      <input type="date" value={form.dewormingDate} onChange={(e) => set("dewormingDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Syphilis Screen Date</label>
                      <input type="date" value={form.syphilisScreenDate} onChange={(e) => set("syphilisScreenDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Syphilis Result</label>
                      <SelectButtonGroup
                        ariaLabel="Syphilis Result"
                        options={SYPHILIS_RESULTS}
                        value={form.syphilisResult}
                        onChange={set("syphilisResult")}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Hepatitis B Screen Date</label>
                      <input type="date" value={form.hepbScreenDate} onChange={(e) => set("hepbScreenDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Hepatitis B Result</label>
                      <SelectButtonGroup
                        ariaLabel="Hepatitis B Result"
                        options={HEPATITIS_B_RESULTS}
                        value={form.hepbResult}
                        onChange={set("hepbResult")}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">HIV Screen Date</label>
                      <input type="date" value={form.hivScreenDate} onChange={(e) => set("hivScreenDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">GDM Screen Date</label>
                      <input type="date" value={form.gdmScreenDate} onChange={(e) => set("gdmScreenDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">GDM Result</label>
                      <SelectButtonGroup
                        ariaLabel="GDM Result"
                        options={GDM_RESULTS}
                        value={form.gdmResult}
                        onChange={set("gdmResult")}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">CBC Screen Date</label>
                      <input type="date" value={form.cbcScreenDate} onChange={(e) => set("cbcScreenDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">CBC Result</label>
                      <SelectButtonGroup
                        ariaLabel="CBC Result"
                        options={CBC_RESULTS}
                        value={form.cbcResult}
                        onChange={set("cbcResult")}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Iron Given (if anemic)</label>
                      <select aria-label="Iron Given" value={form.cbcIronGiven} onChange={(e) => set("cbcIronGiven")(e.target.value)} className={selectCls}>
                        <option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    {[
                      ["Td/TT Dose 1", detail.td1Date || "Not recorded"],
                      ["Td/TT Dose 2", detail.td2Date || "Not recorded"],
                      ["Td/TT Dose 3", detail.td3Date || "Not recorded"],
                      ["Td/TT Dose 4", detail.td4Date || "Not recorded"],
                      ["Td/TT Dose 5", detail.td5Date || "Not recorded"],
                      ["FIM Status", yesNoLabel(detail.fimStatus)],
                      ["Iron + Folic Acid", detail.prenatalIronFolicTablets != null && detail.prenatalIronFolicTablets !== "" ? `${detail.prenatalIronFolicTablets} tablets` : "Not recorded"],
                      ["Calcium Tablets", detail.calciumTablets != null && detail.calciumTablets !== "" ? `${detail.calciumTablets} tablets` : "Not recorded"],
                      ["Iodine Given", detail.iodineGivenDate || "Not recorded"],
                      ["Deworming Date", detail.dewormingDate || "Not recorded"],
                      ["Syphilis Screen", detail.syphilisScreenDate ? `${detail.syphilisScreenDate} (${detail.syphilisResult || "—"})` : "Not recorded"],
                      ["Hepatitis B Screen", detail.hepbScreenDate ? `${detail.hepbScreenDate} (${detail.hepbResult || "—"})` : "Not recorded"],
                      ["HIV Screen", detail.hivScreenDate || "Not recorded"],
                      ["GDM Screen", detail.gdmScreenDate ? `${detail.gdmScreenDate} (${detail.gdmResult || "—"})` : "Not recorded"],
                      ["CBC Screen", detail.cbcScreenDate ? `${detail.cbcScreenDate} (${detail.cbcResult || "—"})` : "Not recorded"],
                      ["Iron Given (if anemic)", yesNoLabel(detail.cbcIronGiven)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
                        <p className="mt-1 text-sm text-gray-900">{value}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

            {activeSection === "prenatal" && <hr className="border-gray-200" />}

            {/* Section C: Delivery Information */}
            <section className={activeSection === "delivery" ? "" : "hidden"}>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Delivery Information</h3>
              <div className="grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-8">
                {isEditing ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Delivery Date</label>
                      <input type="date" value={form.deliveryDate} onChange={(e) => set("deliveryDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Delivery Time</label>
                      <input type="time" value={form.deliveryTime} onChange={(e) => set("deliveryTime")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Delivery Outcome</label>
                      <select value={form.deliveryOutcome} onChange={(e) => set("deliveryOutcome")(e.target.value)} className={selectCls}>
                        <option value="">Select...</option>
                        {DELIVERY_OUTCOMES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Type of Delivery</label>
                      <select value={form.typeOfDelivery} onChange={(e) => set("typeOfDelivery")(e.target.value)} className={selectCls}>
                        <option value="">Select...</option>
                        {DELIVERY_TYPES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Place of Delivery</label>
                      <select value={form.placeOfDelivery} onChange={(e) => set("placeOfDelivery")(e.target.value)} className={selectCls}>
                        <option value="">Select...</option>
                        {DELIVERY_PLACES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Birth Attendant</label>
                      <select value={form.birthAttendant} onChange={(e) => set("birthAttendant")(e.target.value)} className={selectCls}>
                        <option value="">Select...</option>
                        {BIRTH_ATTENDANTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Birth Weight (kg)</label>
                      <input type="number" step="0.01" min={0} value={form.birthWeight} onChange={(e) => set("birthWeight")(e.target.value)} className={inputCls} />
                      {errors.birthWeight && <p className="mt-1 text-xs text-brand-danger">{errors.birthWeight}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Birth Weight Classification</label>
                      <select value={form.birthWeightClass} onChange={(e) => set("birthWeightClass")(e.target.value)} className={selectCls}>
                        <option value="">Select...</option>
                        {BIRTH_WEIGHT_CLASSES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Pregnancy Outcome</label>
                      <select value={form.pregnancyOutcome} onChange={(e) => set("pregnancyOutcome")(e.target.value)} className={selectCls}>
                        <option value="">Select...</option>
                        {PREGNANCY_OUTCOMES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Date Terminated</label>
                      <input type="date" value={form.pregnancyOutcomeDate} onChange={(e) => set("pregnancyOutcomeDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Newborn Sex</label>
                      <select value={form.newbornSex} onChange={(e) => set("newbornSex")(e.target.value)} className={selectCls}>
                        <option value="">Select...</option>
                        {NEWBORN_SEX.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    {[
                      ["Date of Delivery", detail.deliveryDate || "Not recorded"],
                      ["Time of Delivery", detail.deliveryTime || "Not recorded"],
                      ["Delivery Outcome", detail.deliveryOutcome || "Not recorded"],
                      ["Type of Delivery", detail.typeOfDelivery || "Not recorded"],
                      ["Place of Delivery", detail.placeOfDelivery || "Not recorded"],
                      ["Birth Attendant", detail.birthAttendant || "Not recorded"],
                      ["Birth Weight", detail.birthWeight ? `${detail.birthWeight} kg` : "Not recorded"],
                      ["Birth Weight Classification", detail.birthWeightClass || "Not recorded"],
                      ["Pregnancy Outcome", detail.pregnancyOutcome || "Not recorded"],
                      ["Date Terminated", detail.pregnancyOutcomeDate || "Not recorded"],
                      ["Newborn Sex", detail.newbornSex || "Not recorded"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
                        <p className="mt-1 text-sm text-gray-900">{value}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

            {activeSection === "delivery" && <hr className="border-gray-200" />}

            {/* Section D: Postpartum Care */}
            <section className={activeSection === "postpartum" ? "" : "hidden"}>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Postpartum Care Milestones</h3>
              <div className="grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-8">
                {isEditing ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Within 24 hours</label>
                      <input type="date" value={form.ppCheckup24h} onChange={(e) => set("ppCheckup24h")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Day 3</label>
                      <input type="date" value={form.ppCheckupDay3} onChange={(e) => set("ppCheckupDay3")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">7–14 days</label>
                      <input type="date" value={form.ppCheckup7to14d} onChange={(e) => set("ppCheckup7to14d")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">6 weeks after birth</label>
                      <input type="date" value={form.ppCheckup6wk} onChange={(e) => set("ppCheckup6wk")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Iron/Folic Completed</label>
                      <input type="date" value={form.ironFolicCompletedDate} onChange={(e) => set("ironFolicCompletedDate")(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Vitamin A Given</label>
                      <input type="date" value={form.vitaminAGivenDate} onChange={(e) => set("vitaminAGivenDate")(e.target.value)} className={inputCls} />
                    </div>
                  </>
                ) : (
                  <>
                    {[
                      ["Within 24 hours", detail.ppCheckup24h || "Not recorded"],
                      ["Day 3", detail.ppCheckupDay3 || "Not recorded"],
                      ["7–14 days", detail.ppCheckup7to14d || "Not recorded"],
                      ["6 weeks after birth", detail.ppCheckup6wk || "Not recorded"],
                      ["Iron/Folic Completed", detail.ironFolicCompletedDate || "Not recorded"],
                      ["Vitamin A Given", detail.vitaminAGivenDate || "Not recorded"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
                        <p className="mt-1 text-sm text-gray-900">{value}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

            {activeSection === "postpartum" && <hr className="border-gray-200" />}

            {/* Section E: Maternal Health & Lifestyle */}
            <section className={activeSection === "lifestyle" ? "" : "hidden"}>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Maternal Health & Lifestyle Profile</h3>
              <div className="grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-8">
                {isEditing ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Smoking History</label>
                      <select aria-label="Smoking History" value={form.smokingHistory} onChange={(e) => set("smokingHistory")(e.target.value)} className={selectCls}>
                        <option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Binge Alcohol</label>
                      <select aria-label="Binge Alcohol" value={form.bingeAlcohol} onChange={(e) => set("bingeAlcohol")(e.target.value)} className={selectCls}>
                        <option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Insufficient Physical Activity</label>
                      <select aria-label="Insufficient Physical Activity" value={form.insufficientPhysicalActivity} onChange={(e) => set("insufficientPhysicalActivity")(e.target.value)} className={selectCls}>
                        <option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Unhealthy Diet</label>
                      <select aria-label="Unhealthy Diet" value={form.unhealthyDiet} onChange={(e) => set("unhealthyDiet")(e.target.value)} className={selectCls}>
                        <option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">BMI (Asia Pacific)</label>
                      <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                        {calculateBMI()}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">Calculated from the latest recorded height and weight.</p>
                    </div>
                  </>
                ) : (
                  <>
                    {[
                      ["Smoking History", yesNoLabel(detail.smokingHistory)],
                      ["Binge Alcohol", yesNoLabel(detail.bingeAlcohol)],
                      ["Insufficient Physical Activity", yesNoLabel(detail.insufficientPhysicalActivity)],
                      ["Unhealthy Diet", yesNoLabel(detail.unhealthyDiet)],
                      ["BMI (Asia Pacific)", detail.bmi ? String(detail.bmi) : "Not recorded"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
                        <p className="mt-1 text-sm text-gray-900">{value}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

            {/* Clinical Notes */}
            {activeSection === "overview" && (isEditing || detail.notes) ? (
              <>
                <hr className="border-gray-200" />
                <section>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Clinical Notes</h3>
                  {isEditing ? (
                    <textarea rows={4} value={form.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Clinical notes..." className={textareaCls} />
                  ) : (
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap">{detail.notes || "No notes."}</p>
                  )}
                </section>
              </>
            ) : null}

            {activeSection === "prenatal" && (
              <section aria-label="Prenatal encounter history">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Prenatal Encounter History</h3>
                {visitLoadError ? <p role="alert" className="text-sm text-brand-danger">{visitLoadError}</p>
                  : (detail.visits || []).filter((visit) => visit.visit_type === "prenatal").length === 0
                    ? <p className="text-sm text-gray-500">No prenatal encounters recorded.</p>
                    : <ol className="space-y-3">
                      {(detail.visits || []).filter((visit) => visit.visit_type === "prenatal").map((visit) => {
                        const prenatal = visit.clinical_data?.prenatal || {};
                        const recordedServices = [
                          ...[1, 2, 3, 4, 5].filter((dose) => prenatal[`td${dose}Date`]).map((dose) => [`Td/TT dose ${dose}`, prenatal[`td${dose}Date`]]),
                          ["FIM Status", prenatal.fimStatus === "" || prenatal.fimStatus == null ? "" : prenatal.fimStatus === "true" ? "Yes" : "No"],
                          ["Iron + Folic Acid", prenatal.ironFolicTablets || ""],
                          ["Calcium Tablets", prenatal.calciumTablets || ""],
                          ["Iodine Given", prenatal.iodineGivenDate],
                          ["Deworming", prenatal.dewormingDate],
                          ["Syphilis Screen", [prenatal.syphilisScreenDate, prenatal.syphilisResult].filter(Boolean).join(" ")],
                          ["Hepatitis B Screen", [prenatal.hepbScreenDate, prenatal.hepbResult].filter(Boolean).join(" ")],
                          ["HIV Screen", prenatal.hivScreenDate],
                          ["GDM Screen", [prenatal.gdmScreenDate, prenatal.gdmResult].filter(Boolean).join(" ")],
                          ["CBC Screen", [prenatal.cbcScreenDate, prenatal.cbcResult].filter(Boolean).join(" ")],
                          ["Iron Given", prenatal.cbcIronGiven === "" || prenatal.cbcIronGiven == null ? "" : prenatal.cbcIronGiven === "true" ? "Yes" : "No"],
                        ].filter(([, value]) => value !== "");
                        return (
                          <li key={visit.id} className="rounded-lg border border-gray-200 p-3">
                            <div className="flex flex-wrap justify-between gap-2 text-sm">
                              <span className="font-medium text-gray-900">{visit.visit_date}</span>
                              <span className="text-gray-600">{visit.provider || visit.provider_name || "Health personnel"}</span>
                            </div>
                            <p className="mt-1 text-xs text-gray-600">
                              {[visit.blood_pressure ? `BP ${visit.blood_pressure}` : "", visit.weight != null ? `${visit.weight} kg` : "", visit.height_cm != null ? `${visit.height_cm} cm` : ""].filter(Boolean).join(" · ") || "No measurements recorded"}
                            </p>
                            {recordedServices.length > 0 && (
                              <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {recordedServices.map(([label, value]) => (
                                  <div key={label}>
                                    <dt className="text-xs text-gray-500">{label}</dt>
                                    <dd className="text-sm text-gray-800">{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                            {visit.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{visit.notes}</p>}
                          </li>
                        );
                      })}
                    </ol>}
              </section>
            )}
            {activeSection === "delivery" && (
              <section aria-label="Delivery encounter history">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Delivery History</h3>
                {(detail.visits || []).filter((visit) => visit.visit_type === "intrapartum").map((visit) => {
                  const delivery = visit.clinical_data?.delivery || {};
                  return (
                    <div key={visit.id} className="mb-3 rounded-lg border border-gray-200 p-3">
                      <p className="text-sm font-medium text-gray-900">
                        {delivery.deliveryDate || visit.visit_date}
                        {delivery.deliveryTime ? ` · ${delivery.deliveryTime}` : ""}
                      </p>
                      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {[
                          ["Delivery Outcome", delivery.deliveryOutcome],
                          ["Type of Delivery", delivery.typeOfDelivery],
                          ["Place of Delivery", delivery.placeOfDelivery],
                          ["Birth Attendant", delivery.birthAttendant],
                          ["Birth Weight", delivery.birthWeight ? `${delivery.birthWeight} kg` : ""],
                          ["Birth Weight Classification", delivery.birthWeightClass],
                          ["Pregnancy Outcome", delivery.pregnancyOutcome],
                          ["Date Terminated", delivery.pregnancyOutcomeDate],
                          ["Newborn Sex", delivery.newbornSex],
                        ].filter(([, value]) => value).map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-xs text-gray-500">{label}</dt>
                            <dd className="text-sm text-gray-800">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      {visit.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{visit.notes}</p>}
                    </div>
                  );
                })}
                {!(detail.visits || []).some((visit) => visit.visit_type === "intrapartum") && <p className="text-sm text-gray-500">No delivery visit history recorded.</p>}
              </section>
            )}
            {activeSection === "postpartum" && (
              <section aria-label="Postpartum encounter history">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Postpartum Visit History</h3>
                {visitLoadError ? <p role="alert" className="text-sm text-brand-danger">{visitLoadError}</p>
                  : (detail.visits || []).filter((visit) => visit.visit_type === "postpartum").length === 0
                    ? <p className="text-sm text-gray-500">No postpartum visits recorded.</p>
                    : <ol className="space-y-3">
                      {(detail.visits || []).filter((visit) => visit.visit_type === "postpartum").map((visit) => (
                        <li key={visit.id} className="rounded-lg border border-gray-200 p-3">
                          <p className="text-sm font-medium text-gray-900">{visit.visit_date} · {visit.clinical_data?.postpartum?.milestone || "Postpartum visit"}</p>
                          <p className="mt-1 text-xs text-gray-600">
                            Iron/Folic: {yesNoLabel(visit.clinical_data?.postpartum?.ironFolicCompleted)}
                            {" · "}Vitamin A: {yesNoLabel(visit.clinical_data?.postpartum?.vitaminAGiven)}
                          </p>
                          {visit.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{visit.notes}</p>}
                        </li>
                      ))}
                    </ol>}
              </section>
            )}
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-between gap-3">
          <button
            onClick={() => onDelete?.(detail)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/10 rounded-lg transition-colors"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-brand-blue hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onRecordEncounter?.(detail)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  <Calendar className="h-4 w-4" /> Prenatal Encounter
                </button>
                <button
                  type="button"
                  onClick={() => onRecordDelivery?.(detail)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  <Baby className="h-4 w-4" /> Delivery
                </button>
                <button
                  type="button"
                  onClick={() => onRecordPostpartum?.(detail)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  <Calendar className="h-4 w-4" /> Postpartum Visit
                </button>
                <button
                  onClick={() => onPrint?.(detail)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-brand-blue hover:bg-blue-700 rounded-lg transition-colors"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

export default MaternalRecordEditor;
