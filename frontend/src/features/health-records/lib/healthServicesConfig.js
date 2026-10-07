import {
  Users, HeartPulse, Syringe, Smile, Activity, Droplets, ShieldAlert, FileBarChart2,
} from "lucide-react";

/**
 * KALUSAGAP — Health Services configuration (single source for the M1 launcher).
 *
 * One reusable definition of every FHSIS M1 program section shown under
 * "Health Services" on the M1 page. The SAME config drives the service summary
 * (name, icon, description, data source, navigation) so no service can render
 * with inconsistent wording or styling.
 *
 * Each service declares:
 *   key          FHSIS section key (A–H) — also the key used by the M1
 *                aggregation API (GET /m1/report → byCode[].section)
 *   name         display name in the summary
 *   description  short supporting text (kept concise)
 *   icon         lucide icon (existing project icon library)
 *   source       'm1' (M1 section / reporting figures) or 'operational'
 *                (backed by operational service records)
 *   open         how the service is opened: a route to navigate to
 *                ({ to }) or an in-page section key
 *
 * Source classification follows the existing implementation and the backend
 * M1 catalog (backend/src/config/m1Catalog.js):
 *   Family Planning / Oral Health / NCD / Infectious Disease / Vital
 *   Statistics → M1 section (section workspace with derived + manual
 *   reporting figures; Family Planning also derives from household member
 *   FP methods).
 *   Maternal Care → operational records (maternal_records in-page).
 *   Child Care → operational records (existing Immunization module).
 *   Environmental Health → operational records (existing Households module,
 *   WASH fields feed Section G).
 */

const SERVICE_ICONS = Object.freeze({
  familyPlaning: Users,
  maternalCare: HeartPulse,
  childCare: Syringe,
  oralHealth: Smile,
  ncd: Activity,
  environmentalHealth: Droplets,
  infectiousDisease: ShieldAlert,
  vitalStatistics: FileBarChart2,
});

export const HEALTH_SERVICES = Object.freeze([
  {
    key: "A",
    name: "Family Planning",
    description: "Reproductive health and family planning services",
    icon: SERVICE_ICONS.familyPlaning,
    source: "m1",
    open: { section: "A" },
  },
  {
    key: "B",
    name: "Maternal Care",
    description: "Individual maternal cases — operational source for Section B",
    icon: SERVICE_ICONS.maternalCare,
    source: "operational",
    open: { section: "B" },
  },
  {
    key: "C",
    name: "Child Care",
    description: "Immunization, nutrition and child services",
    icon: SERVICE_ICONS.childCare,
    source: "operational",
    open: { to: "../immunization" },
  },
  {
    key: "D",
    name: "Oral Health",
    description: "Oral health care visits across age groups",
    icon: SERVICE_ICONS.oralHealth,
    source: "m1",
    open: { section: "D" },
  },
  {
    key: "F",
    name: "Non-Communicable Diseases",
    description: "Risk assessment, hypertension, diabetes, cancer screening",
    icon: SERVICE_ICONS.ncd,
    source: "m1",
    open: { section: "F" },
  },
  {
    key: "G",
    name: "Environmental Health",
    description: "Household water supply and sanitation",
    icon: SERVICE_ICONS.environmentalHealth,
    source: "operational",
    open: { to: "../households" },
  },
  {
    key: "E",
    name: "Infectious Disease",
    description: "TB, rabies, schistosomiasis, leprosy, malaria",
    icon: SERVICE_ICONS.infectiousDisease,
    source: "m1",
    open: { section: "E" },
  },
  {
    key: "H",
    name: "Vital Statistics",
    description: "Mortality and natality reporting indicators",
    icon: SERVICE_ICONS.vitalStatistics,
    source: "m1",
    open: { section: "H" },
  },
]);

/** FHSIS section title lookup (longer official name used by section panels). */
export const HEALTH_SERVICE_TITLES = Object.freeze(
  Object.fromEntries(HEALTH_SERVICES.map((s) => [s.key, s.name])),
);

/** Standardized source label shown in the summary. */
export const SERVICE_SOURCE_LABEL = Object.freeze({
  m1: "M1 section",
  operational: "Operational records",
});

/** True when a service is backed by operational records (not manual M1 figures). */
export const isOperationalService = (source) => source === "operational";

/**
 * Pluralize a record count: 0 records / 1 record / 2 records.
 * Never returns "1 records" and never exposes undefined/null/NaN as a label.
 */
export const recordCountLabel = (count) => {
  const n = Number(count);
  if (!Number.isFinite(n)) return "records";
  return n === 1 ? "record" : "records";
};

export default HEALTH_SERVICES;