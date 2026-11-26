// frontend/src/features/health-records/lib/m1DetailFormatter.js
/**
 * M1 Detail Formatting Utility
 *
 * Converts raw database field names and coded values into human-readable
 * labels and descriptions for the Underlying Records modal.
 */

// Reference mappings for common coded fields
const FIELD_LABELS = {
  // WASH (Environmental Health)
  water_source: "Water Source",
  toilet_type: "Toilet Type",
  waste_disposal: "Waste Disposal",
  handwashing_facility: "Handwashing Facility",

  // Family Planning
  fp_method: "Family Planning Method",
  contraceptive_type: "Contraceptive Type",

  // Nutrition & Health
  nutrition_status: "Nutrition Status",
  vitamin_a_given: "Vitamin A Given",
  deworming_given: "Deworming Given",

  // Maternal & Prenatal
  trimester: "Trimester",
  prenatal_visit_type: "Prenatal Visit Type",
  delivery_type: "Delivery Type",
  birth_outcome: "Birth Outcome",
  newborn_screening: "Newborn Screening",

  // Disease & Immunization
  disease_type: "Disease Type",
  immunization_type: "Immunization Type",
  screening_result: "Screening Result",
  tb_status: "TB Status",
  hiv_status: "HIV Status",

  // Oral Health
  tooth_condition: "Tooth Condition",
  cavity_status: "Cavity Status",
  gum_health: "Gum Health",

  // General
  status: "Status",
  remarks: "Remarks",
  provider: "Provider",
};

// Value mappings for coded values
const VALUE_MAPPINGS = {
  water_source: {
    level1: "Level 1 (Piped Water)",
    level2: "Level 2 (Hand Pump)",
    level3: "Level 3 (Open Well)",
    other: "Other",
  },
  toilet_type: {
    ws_own: "Own Water-Sealed Toilet",
    ws_shared: "Shared Water-Sealed Toilet",
    pit_own: "Own Pit Toilet",
    pit_shared: "Shared Pit Toilet",
    none: "No Toilet",
  },
  waste_disposal: {
    segregated: "Segregated Waste",
    unsegregated: "Unsegregated Waste",
    open_dump: "Open Dump",
    none: "None",
  },
  handwashing_facility: {
    available: "Available",
    with_soap: "Available with Soap",
    none: "Not Available",
  },
  fp_method: {
    pill: "Pill",
    condom: "Condom",
    iud: "IUD",
    implant: "Implant",
    injection: "Injection",
    sterilization: "Sterilization",
    natural: "Natural Family Planning",
    other: "Other",
  },
  nutrition_status: {
    normal: "Normal",
    underweight: "Underweight",
    overweight: "Overweight",
    obese: "Obese",
    severe_acute_malnutrition: "Severe Acute Malnutrition",
  },
  trimester: {
    first: "First Trimester",
    second: "Second Trimester",
    third: "Third Trimester",
  },
  delivery_type: {
    vaginal: "Vaginal",
    cesarean: "Cesarean Section",
  },
  birth_outcome: {
    live: "Live Birth",
    stillbirth: "Stillbirth",
    miscarriage: "Miscarriage",
  },
  screening_result: {
    positive: "Positive",
    negative: "Negative",
    reactive: "Reactive",
    non_reactive: "Non-Reactive",
  },
  status: {
    completed: "Completed",
    pending: "Pending",
    referred: "Referred",
    declined: "Declined",
    not_done: "Not Done",
    active: "Active",
    inactive: "Inactive",
  },
};

/**
 * Format a single detail field for display.
 * Converts database field names and coded values into human-readable text.
 *
 * @param {string} key - Field name (e.g., "water_source")
 * @param {any} value - Raw value (e.g., "level3")
 * @returns {string} Human-readable label and value
 */
export function formatDetailField(key, value) {
  // Skip null, undefined, empty strings, empty objects
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "object" && Object.keys(value).length === 0)
  ) {
    return null;
  }

  const label = FIELD_LABELS[key] || formatLabel(key);

  // If value is an object, format it as key-value pairs
  if (typeof value === "object" && !Array.isArray(value)) {
    const formatted = Object.entries(value)
      .map(([k, v]) => `${formatLabel(k)}: ${formatValue(k, v)}`)
      .join(", ");
    return `${label}: ${formatted}`;
  }

  // If value is an array, join with commas
  if (Array.isArray(value)) {
    const formatted = value
      .map((v) => formatValue(key, v))
      .filter(Boolean)
      .join(", ");
    return formatted ? `${label}: ${formatted}` : null;
  }

  // Single value
  const formattedValue = formatValue(key, value);
  return formattedValue ? `${label}: ${formattedValue}` : null;
}

/**
 * Format a raw value into human-readable text.
 * Looks up coded values in VALUE_MAPPINGS, or returns the value as-is.
 *
 * @param {string} key - Field name
 * @param {any} value - Raw value
 * @returns {string} Formatted value
 */
export function formatValue(key, value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  // Check if there's a mapping for this field's value
  if (VALUE_MAPPINGS[key] && VALUE_MAPPINGS[key][value]) {
    return VALUE_MAPPINGS[key][value];
  }

  // Handle booleans
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  // Handle dates
  if (value instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    try {
      const date = new Date(value);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return String(value);
    }
  }

  // Return as string
  return String(value);
}

/**
 * Convert snake_case field names to Title Case labels.
 *
 * @param {string} key - Field name (e.g., "water_source")
 * @returns {string} Title case (e.g., "Water Source")
 */
export function formatLabel(key) {
  return (
    key
      // Insert space before uppercase letters (camelCase → camel Case)
      .replace(/([A-Z])/g, " $1")
      // Replace underscores with spaces
      .replace(/_/g, " ")
      // Capitalize each word
      .replace(/\b\w/g, (char) => char.toUpperCase())
      // Clean up extra spaces
      .trim()
  );
}

/**
 * Format all detail fields for a record into an array of display strings.
 *
 * @param {object} detail - Detail object from record
 * @returns {array} Array of formatted field strings
 */
export function formatDetailsArray(detail) {
  if (!detail || typeof detail !== "object") {
    return [];
  }

  return Object.entries(detail)
    .map(([key, value]) => formatDetailField(key, value))
    .filter(Boolean);
}

/**
 * Format all detail fields into a structured display object.
 *
 * @param {object} detail - Detail object from record
 * @returns {object} { fields: [{ label, value }], count: number }
 */
export function formatDetailsStructured(detail) {
  if (!detail || typeof detail !== "object") {
    return { fields: [], count: 0 };
  }

  const fields = Object.entries(detail)
    .map(([key, value]) => {
      const formatted = formatDetailField(key, value);
      if (!formatted) return null;

      // Parse the formatted string into label and value
      const [label, ...valueParts] = formatted.split(": ");
      return {
        label,
        value: valueParts.join(": "),
      };
    })
    .filter(Boolean);

  return { fields, count: fields.length };
}
