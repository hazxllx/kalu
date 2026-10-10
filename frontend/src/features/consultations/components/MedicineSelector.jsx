import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Trash2, Pill } from "lucide-react";
import { medicinesApi } from "@/services/api";

const inputCls =
  "w-full bg-white border border-brand-border rounded-btn px-2.5 py-1.5 text-sm outline-none focus:border-brand-blue";

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
  if (source === "yakap") {
    return (
      <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[10px] font-semibold text-brand-blue">
        YAKAP
      </span>
    );
  }
  if (source === "custom") {
    return (
      <span className="rounded-full bg-brand-amber/10 px-2 py-0.5 text-[10px] font-semibold text-brand-amber">
        Custom
      </span>
    );
  }
  return (
    <span className="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-semibold text-brand-gray">
      Local
    </span>
  );
};

/**
 * Searchable Medications / Prescriptions selector with manual entry.
 *
 * - Type to search the admin-managed catalog by generic name, strength or form.
 * - Select a result to add it as a removable row, or add a custom (manually
 *   typed) medicine when it is not in the catalog.
 * - Each added medicine records optional dose/route/frequency/duration/quantity
 *   and instructions. Multiple medicines are supported.
 *
 * Custom entries are kept verbatim and never silently replaced by a catalog
 * entry. The value is an array of medication objects owned by the parent form.
 */
export default function MedicineSelector({ value = [], onChange, facilityId = "" }) {
  const medications = Array.isArray(value) ? value : [];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  // Debounced catalog search.
  useEffect(() => {
    const term = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!term) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      medicinesApi
        .list({ q: term, ...(facilityId ? { facilityId } : {}) })
        .then((res) => setResults(res?.medicines || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query, facilityId]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const addMedication = (med) => {
    onChange([...medications, med]);
    setQuery("");
    setResults([]);
    setOpen(false);
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
    onChange(medications.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const removeAt = (index) => {
    onChange(medications.filter((_, i) => i !== index));
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
    <div>
      {/* Added medicines */}
      {medications.length > 0 && (
        <ul className="mb-3 space-y-2">
          {medications.map((m, i) => (
            <li
              key={`${m.medicineId || "custom"}-${i}`}
              className="rounded-btn border border-brand-border bg-brand-bg/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Pill className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
                  <span className="truncate text-sm font-medium text-brand-ink">
                    {m.genericName || "(unnamed medicine)"}
                  </span>
                  <SourceTag source={m.custom ? "custom" : m.source} />
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-gray transition-colors hover:text-brand-danger"
                  aria-label={`Remove ${m.genericName || "medicine"}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                {m.custom ? (
                  <>
                    <input
                      aria-label="Generic name"
                      value={m.genericName}
                      onChange={(e) => updateAt(i, { genericName: e.target.value })}
                      placeholder="Generic name"
                      className={inputCls}
                    />
                    <input
                      aria-label="Strength"
                      value={m.strength}
                      onChange={(e) => updateAt(i, { strength: e.target.value })}
                      placeholder="Strength (e.g. 500 mg)"
                      className={inputCls}
                    />
                    <input
                      aria-label="Dosage form"
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
                <input
                  aria-label="Dose"
                  value={m.dose}
                  onChange={(e) => updateAt(i, { dose: e.target.value })}
                  placeholder="Dose (e.g. 1 tab)"
                  className={inputCls}
                />
                <input
                  aria-label="Route"
                  value={m.route}
                  onChange={(e) => updateAt(i, { route: e.target.value })}
                  placeholder="Route (e.g. Oral)"
                  className={inputCls}
                />
                <input
                  aria-label="Frequency"
                  value={m.frequency}
                  onChange={(e) => updateAt(i, { frequency: e.target.value })}
                  placeholder="Frequency (e.g. TID)"
                  className={inputCls}
                />
                <input
                  aria-label="Duration"
                  value={m.duration}
                  onChange={(e) => updateAt(i, { duration: e.target.value })}
                  placeholder="Duration (e.g. 7 days)"
                  className={inputCls}
                />
                <input
                  aria-label="Quantity"
                  value={m.quantity}
                  onChange={(e) => updateAt(i, { quantity: e.target.value })}
                  placeholder="Quantity (e.g. 21)"
                  className={inputCls}
                />
                <input
                  aria-label="Additional instructions"
                  value={m.instructions}
                  onChange={(e) => updateAt(i, { instructions: e.target.value })}
                  placeholder="Instructions"
                  className={`${inputCls} col-span-2 sm:col-span-3`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Search / add */}
      <div ref={wrapRef} className="relative">
        <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2 focus-within:border-brand-blue">
          <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search medicine by generic name, strength, or type..."
            aria-label="Search medicine by generic name, strength, or type"
            className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70"
          />
        </div>

        {open && query.trim() && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-btn border border-brand-border bg-white shadow-float">
            <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
              {loading && (
                <li className="px-3 py-2 text-sm text-brand-gray">Searching...</li>
              )}
              {!loading &&
                visibleResults.map((m) => (
                  <li key={m.id} role="option" aria-selected="false">
                    <button
                      type="button"
                      onClick={() => addFromCatalog(m)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-brand-bg"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-brand-ink">
                          {m.genericName}
                        </span>
                        <span className="block truncate text-xs text-brand-gray">
                          {[m.strength, m.dosageForm, m.category].filter(Boolean).join(" \u00b7 ")}
                        </span>
                      </span>
                      <SourceTag source={m.source} />
                    </button>
                  </li>
                ))}
              {!loading && visibleResults.length === 0 && (
                <li className="px-3 py-2 text-sm text-brand-gray">
                  No matching medicine in the catalog.
                </li>
              )}
              {!loading && !exactMatch && (
                <li className="border-t border-brand-border">
                  <button
                    type="button"
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
      <p className="mt-1.5 text-xs text-brand-gray">
        Search the catalog or add a custom medicine. Add as many as needed; each can be removed.
      </p>
    </div>
  );
}
