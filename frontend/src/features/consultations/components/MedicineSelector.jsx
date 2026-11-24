import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Trash2, Pill, ChevronDown, ChevronUp } from "lucide-react";
import { medicinesApi } from "@/services/api";
import SearchableSelect from "@/components/common/SearchableSelect";
import { isDuplicateMedicine } from "../lib/consultationForm";
import { PRESCRIPTION_ROUTES, PRESCRIPTION_FREQUENCIES } from "../../../../../shared/consultationClinical.js";

const inputCls =
  "h-10 w-full min-w-0 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-blue disabled:opacity-70 dark:border-border dark:bg-card dark:text-foreground";

const recordedOptions = (options, value) => value && !options.some((option) => option.value === value)
  ? [{ value, label: `${value} (recorded value)` }, ...options]
  : options;

const emptyMedication = (overrides = {}) => ({
  medicineId: null,
  genericName: "",
  brandName: "",
  strength: "",
  dosageForm: "",
  dose: "",
  route: "",
  frequency: "",
  duration: "",
  quantity: "",
  instructions: "",
  custom: true,
  source: "custom",
  ...overrides,
});

const SourceTag = ({ source }) => {
  if (source === "custom") {
    return (
      <span className="rounded-full bg-brand-amber/10 px-2 py-0.5 text-[10px] font-semibold text-brand-amber">
        Custom
      </span>
    );
  }
  if (source === "yakap") return null;
  return (
    <span className="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-semibold text-brand-gray">
      Local
    </span>
  );
};

/**
 * Searchable Medications / Prescriptions selector with manual entry.
 *
 * - Type to search the admin-managed catalog by generic OR brand name (e.g.
 *   "Biogesic" resolves to its generic, paracetamol), strength or form.
 * - Select a result to add it as a removable row, or add a custom (manually
 *   typed) medicine when it is not in the catalog. Catalog information never
 *   pre-fills a patient-specific prescription.
 * - Each added medicine records optional dose/route/frequency/duration/quantity
 *   and instructions. Multiple medicines are supported.
 *
 * Custom entries are kept verbatim and never silently replaced by a catalog
 * entry. The value is an array of medication objects owned by the parent form.
 *
 * @param {{value?: any[], onChange: (value: any[]) => void, errors?: Record<string, string>, disabled?: boolean}} props
 */
export default function MedicineSelector({
  value = [],
  onChange,
  errors = {},
  disabled = false,
  collapsible = false,
}) {
  const medications = Array.isArray(value) ? value : [];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [open, setOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(!collapsible);
  const [expandedMedicationIndices, setExpandedMedicationIndices] = useState(() => new Set());
  const wrapRef = useRef(null);
  const searchInputRef = useRef(null);
  const debounceRef = useRef(null);

  // Debounced catalog search (matches generic name, brand name, strength, form).
  useEffect(() => {
    let active = true;
    const term = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!term) {
      setResults([]);
      setLoading(false);
      setSearchError("");
      return undefined;
    }
    setResults([]);
    setSearchError("");
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      medicinesApi
        .list({ q: term })
        .then((res) => { if (active) setResults(res?.medicines || []); })
        .catch(() => { if (active) setSearchError("The medication catalog could not be loaded. Retry the search before selecting a catalog medicine."); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (collapsible && searchExpanded) searchInputRef.current?.focus();
  }, [collapsible, searchExpanded]);

  useEffect(() => {
    if (!collapsible) return;
    const invalidIndices = Object.keys(errors).reduce((indices, field) => {
      const match = field.match(/^medications\[(\d+)\]/);
      if (match) indices.push(Number(match[1]));
      return indices;
    }, []);
    if (invalidIndices.length) {
      setExpandedMedicationIndices((previous) => new Set([...previous, ...invalidIndices]));
    }
  }, [collapsible, errors]);

  const addMedication = (med) => {
    if (disabled) return;
    if (isDuplicateMedicine(medications, med)) {
      setSearchError("This medicine is already in the prescription list.");
      return;
    }
    onChange([...medications, med]);
    setQuery("");
    setResults([]);
    setSearchError("");
    setOpen(false);
    if (collapsible) setSearchExpanded(false);
  };

  const addFromCatalog = (m) =>
    addMedication(
      emptyMedication({
        medicineId: m.id,
        genericName: m.genericName,
        brandName: m.brandName || "",
        strength: m.strength || "",
        dosageForm: m.dosageForm || "",
        custom: false,
        source: m.source || "local",
      })
    );

  const addCustom = () => {
    const name = query.trim();
    if (!name) return;
    addMedication(emptyMedication({ genericName: name }));
  };

  const updateAt = (index, patch) => {
    if (disabled) return;
    onChange(medications.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const removeAt = (index) => {
    if (disabled) return;
    onChange(medications.filter((_, i) => i !== index));
    setExpandedMedicationIndices((previous) => new Set(
      [...previous]
        .filter((expandedIndex) => expandedIndex !== index)
        .map((expandedIndex) => expandedIndex > index ? expandedIndex - 1 : expandedIndex)
    ));
  };

  // Hide catalog results that are already added (same catalog id).
  const addedIds = useMemo(
    () => new Set(medications.filter((m) => m.medicineId).map((m) => m.medicineId)),
    [medications]
  );
  const visibleResults = results.filter((m) => !addedIds.has(m.id));
  const exactMatch = results.some(
    (m) => m.genericName.trim().toLowerCase() === query.trim().toLowerCase()
  );

  return (
    <div className={collapsible ? "rounded-btn border border-brand-border bg-white p-3 dark:border-border dark:bg-card" : ""}>
      {errors.medications && <p role="alert" className="mb-2 text-xs text-brand-danger">{errors.medications}</p>}
      {/* Added medicines */}
      {medications.length > 0 && (
        <ul className="mb-3 space-y-2">
          {medications.map((m, i) => (
            <li
              key={`${m.medicineId || "custom"}-${i}`}
              className={`min-w-0 rounded-btn border border-brand-border bg-brand-bg/40 dark:border-border dark:bg-card/40 ${
                collapsible && !expandedMedicationIndices.has(i) ? "px-3 py-2" : "p-3"
              }`}
            >
              <div className={`flex items-center justify-between gap-3 ${
                !collapsible || expandedMedicationIndices.has(i) ? "border-b border-brand-border pb-2" : ""
              }`}>
                <div className="flex min-w-0 items-center gap-2">
                  <Pill className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-brand-ink">
                      {m.genericName || "(unnamed medicine)"}
                      {m.brandName && (
                        <span className="font-normal text-brand-gray"> ({m.brandName})</span>
                      )}
                    </p>
                    {collapsible && !expandedMedicationIndices.has(i) && (m.strength || m.dosageForm) && (
                      <p className="text-xs text-brand-gray">
                        {[m.strength, m.dosageForm].filter(Boolean).join(" \u00b7 ")}
                      </p>
                    )}
                  </div>
                  {(!collapsible || expandedMedicationIndices.has(i)) && (
                    <SourceTag source={m.custom ? "custom" : m.source} />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {collapsible && (
                    <button
                      type="button"
                      disabled={disabled}
                      aria-expanded={expandedMedicationIndices.has(i)}
                      aria-controls={`medicine-prescription-${i}`}
                      onClick={() => setExpandedMedicationIndices((previous) => {
                        const next = new Set(previous);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })}
                      className="flex h-8 w-8 items-center justify-center rounded-btn text-brand-blue transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={`${expandedMedicationIndices.has(i) ? "Hide" : "Show"} prescription details for ${m.genericName || "medicine"}`}
                    >
                      {expandedMedicationIndices.has(i)
                        ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeAt(i)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn border border-brand-border text-brand-gray transition-colors hover:border-brand-danger hover:text-brand-danger"
                    aria-label={`Remove ${m.genericName || "medicine"}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {(!collapsible || expandedMedicationIndices.has(i)) && (
                <div id={`medicine-prescription-${i}`}>
                  {!([m.dose, m.route, m.frequency, m.duration, m.quantity, m.instructions]
                    .some((field) => String(field ?? "").trim())) && (
                    <p className="mt-2 text-xs font-medium text-brand-amber" role="status">
                      Prescription not yet provided
                    </p>
                  )}

                  <div className="mt-3 grid min-w-0 grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {m.custom ? (
                  <>
                    <input
                      aria-label="Generic name"
                      disabled={disabled}
                      value={m.genericName}
                      onChange={(e) => updateAt(i, { genericName: e.target.value })}
                      placeholder="Generic name"
                      className={inputCls}
                    />
                    <input
                      aria-label="Strength"
                      disabled={disabled}
                      value={m.strength}
                      onChange={(e) => updateAt(i, { strength: e.target.value })}
                      placeholder="Strength (e.g. 500 mg)"
                      className={inputCls}
                    />
                    <input
                      aria-label="Dosage form"
                      disabled={disabled}
                      value={m.dosageForm}
                      onChange={(e) => updateAt(i, { dosageForm: e.target.value })}
                      placeholder="Form (e.g. Tablet)"
                      className={inputCls}
                    />
                  </>
                ) : (
                  <p className="col-span-2 text-xs text-brand-gray sm:col-span-3">
                    {[m.strength, m.dosageForm].filter(Boolean).join(" \u00b7 ") || "No strength/form on file"}
                  </p>
                )}
                <label className="text-xs text-brand-gray">Dose <span className="text-brand-danger">*</span>
                  <input aria-label="Dose" disabled={disabled} value={m.dose} onChange={(e) => updateAt(i, { dose: e.target.value })} placeholder="e.g. 1 tablet" className={`${inputCls} mt-1.5`} />
                </label>
                <SearchableSelect
                  label="Route" ariaLabel="Route" value={m.route || ""} required
                  onChange={(route) => updateAt(i, { route })}
                  options={recordedOptions(PRESCRIPTION_ROUTES, m.route)} placeholder="Select route"
                  error={errors[`medications[${i}].route`] || ""} disabled={disabled} compact portalDropdown
                />
                <SearchableSelect
                  label="Frequency" ariaLabel="Frequency" value={m.frequency || ""} required
                  onChange={(frequency) => updateAt(i, { frequency })}
                  options={recordedOptions(PRESCRIPTION_FREQUENCIES, m.frequency)} placeholder="Select frequency"
                  error={errors[`medications[${i}].frequency`] || ""} disabled={disabled} compact portalDropdown
                />
                <label className="text-xs text-brand-gray">Duration <span className="text-brand-danger">*</span>
                  <input aria-label="Duration" disabled={disabled} value={m.duration} onChange={(e) => updateAt(i, { duration: e.target.value })} placeholder="e.g. 7 days" className={`${inputCls} mt-1.5`} />
                </label>
                <label className="text-xs text-brand-gray">Quantity <span className="text-brand-danger">*</span>
                  <input aria-label="Quantity" inputMode="numeric" disabled={disabled} value={m.quantity} onChange={(e) => updateAt(i, { quantity: e.target.value })} placeholder="e.g. 21" className={`${inputCls} mt-1.5`} />
                </label>
                <label className="col-span-2 text-xs text-brand-gray sm:col-span-3">Instructions
                  <input aria-label="Additional instructions" disabled={disabled} value={m.instructions} onChange={(e) => updateAt(i, { instructions: e.target.value })} placeholder="Medicine-specific instructions" className={`${inputCls} mt-1.5`} />
                </label>
              </div>
                {Object.entries(errors).filter(([field]) => field.startsWith(`medications[${i}]`) && !["route", "frequency"].includes(field.split(".").pop())).map(([field, message]) => (
                  <p key={field} className="mt-1 text-xs text-brand-danger" role="alert">{field.split(".").pop()}: {String(message)}</p>
                ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {collapsible && (
        <button
          type="button"
          disabled={disabled}
          aria-expanded={searchExpanded}
          aria-controls="medicine-search-panel"
          onClick={() => setSearchExpanded((expanded) => !expanded)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-btn border border-brand-blue px-3 py-1.5 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {searchExpanded ? "Close medicine search" : "Add Medicine"}
        </button>
      )}

      {/* Search / add */}
      <div
        id={collapsible ? "medicine-search-panel" : undefined}
        aria-hidden={collapsible && !searchExpanded}
        className={collapsible
          ? `transition-[margin,opacity] duration-200 ease-in-out ${searchExpanded ? "mt-3 opacity-100" : "mt-0 opacity-0 pointer-events-none"}`
          : ""}
      >
        <div ref={wrapRef} className="relative">
          <div className={collapsible
            ? `overflow-hidden transition-[max-height] duration-200 ease-in-out ${searchExpanded ? "max-h-12" : "max-h-0"}`
            : ""}
          >
            <div className="flex min-w-0 items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2 focus-within:border-brand-blue dark:border-border dark:bg-card">
              <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={query}
                disabled={disabled || (collapsible && !searchExpanded)}
                tabIndex={collapsible && !searchExpanded ? -1 : undefined}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Search medicine by generic or brand name (e.g. paracetamol or Biogesic)..."
                aria-label="Search medicine by generic or brand name"
                className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70 dark:text-foreground"
              />
            </div>
          </div>

          {open && !disabled && (!collapsible || searchExpanded) && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-btn border border-brand-border bg-white shadow-float dark:border-border dark:bg-card">
              <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
                {!query.trim() && <li className="px-3 py-2 text-sm text-brand-gray">Search by generic or brand name.</li>}
                {loading && (
                  <li className="px-3 py-2 text-sm text-brand-gray">Searching...</li>
                )}
                {!loading &&
                  visibleResults.map((m) => (
                    <li key={m.id} role="option" aria-selected="false">
                      <button
                        type="button"
                        tabIndex={collapsible && !searchExpanded ? -1 : undefined}
                        onClick={() => addFromCatalog(m)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-brand-bg dark:hover:bg-muted/50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-brand-ink dark:text-foreground">
                            {m.brandName || m.genericName}
                          </span>
                          <span className="block truncate text-xs text-brand-gray">
                            {[m.brandName ? m.genericName : null, m.strength, m.dosageForm, m.category]
                              .filter(Boolean)
                              .join(" \u00b7 ")}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                {!loading && !searchError && query.trim() && visibleResults.length === 0 && (
                  <li className="px-3 py-2 text-sm text-brand-gray">
                    No matching medicine in the catalog.
                  </li>
                )}
                {searchError && <li className="px-3 py-2 text-sm text-brand-danger" role="alert">{searchError}</li>}
                {!loading && query.trim() && !exactMatch && (
                  <li className="border-t border-brand-border">
                    <button
                      type="button"
                      tabIndex={collapsible && !searchExpanded ? -1 : undefined}
                      onClick={addCustom}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-brand-blue transition-colors hover:bg-brand-bg"
                    >
                      <Plus className="h-4 w-4" />
                      Add custom medicine &ldquo;{query.trim()}&rdquo;
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

      {!collapsible && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            searchInputRef.current?.focus();
          }}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-btn border border-brand-blue px-3 py-1.5 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Medicine
        </button>
      )}
      {!open && searchError && <p className="mt-1 text-xs text-brand-danger" role="alert">{searchError}</p>}
      {errors.medications && <p className="mt-1 text-xs text-brand-danger" role="alert">{errors.medications}</p>}
    </div>
  );
}
