import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Check, Building2, Plus } from "lucide-react";

const typeLabel = (t) => (t === "rhu" ? "RHU" : t === "barangay_health_station" ? "BHS" : "");

/**
 * Creatable, searchable facility field for the Add Health Service modal.
 *
 * Replaces the plain, non-editable facility <select>. The user can:
 *   - type to filter existing facilities (case-insensitive, multi-token);
 *   - pick the pinned "Municipality-wide / RHU-wide" row for a service with no
 *     specific facility;
 *   - pick an existing facility (its coverage is applied automatically); or
 *   - enter a brand-new facility name via the "Use new facility" row (the
 *     backend de-duplicates and persists it).
 *
 * There is no barangay selector: the barangay is derived server-side from the
 * chosen facility and the authenticated session.
 *
 * @param {Object}   props
 * @param {Array<{id:string,name:string,type:string,barangayId:?string}>} props.facilities
 * @param {{facilityId:string, facilityName:string, municipalityWide:boolean}} props.value
 * @param {(nextPartial:Object) => void} props.onChange  Called with the changed subset of value.
 * @param {string}   [props.placeholder]
 * @param {string}   [props.error]
 */
export default function FacilityField({
  facilities = [],
  value,
  onChange,
  placeholder = "Search or type a facility name...",
  error = "",
}) {
  const { facilityId = "", facilityName = "", municipalityWide = false } = value || {};
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // What the input shows when the user is not actively typing.
  const selectedLabel = useMemo(() => {
    if (municipalityWide) return "Municipality-wide / RHU-wide";
    if (facilityId) {
      const f = facilities.find((x) => String(x.id) === String(facilityId));
      if (f) return `${f.name}${typeLabel(f.type) ? ` (${typeLabel(f.type)})` : ""}`;
    }
    return facilityName || "";
  }, [municipalityWide, facilityId, facilityName, facilities]);

  const controlValue = editing ? query : selectedLabel;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return facilities;
    const tokens = q.split(/\s+/).filter(Boolean);
    return facilities.filter((f) => {
      const label = `${f.name} ${typeLabel(f.type)}`.toLowerCase();
      return tokens.every((t) => label.includes(t));
    });
  }, [facilities, query]);

  const trimmedQuery = query.trim();
  const exactMatch = useMemo(
    () => facilities.some((f) => f.name.trim().toLowerCase() === trimmedQuery.toLowerCase()),
    [facilities, trimmedQuery],
  );
  const canCreate = editing && trimmedQuery.length > 0 && !exactMatch;

  // Ordered row model: [municipality-wide, ...matching facilities, create?]
  const rows = useMemo(() => {
    const list = [{ kind: "muni", key: "muni" }];
    for (const f of results) list.push({ kind: "facility", key: `f-${f.id}`, facility: f });
    if (canCreate) list.push({ kind: "create", key: "create", name: trimmedQuery });
    return list;
  }, [results, canCreate, trimmedQuery]);

  useEffect(() => setHighlighted(0), [query, facilities.length, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const commit = (row) => {
    if (!row) return;
    if (row.kind === "muni") onChange({ municipalityWide: true, facilityId: "", facilityName: "" });
    else if (row.kind === "facility") {
      onChange({ municipalityWide: false, facilityId: String(row.facility.id), facilityName: row.facility.name });
    } else if (row.kind === "create") {
      onChange({ municipalityWide: false, facilityId: "", facilityName: row.name });
    }
    setQuery("");
    setEditing(false);
    setOpen(false);
  };

  const clear = () => {
    onChange({ municipalityWide: false, facilityId: "", facilityName: "" });
    setQuery("");
    setEditing(true);
    setHighlighted(0);
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        setEditing(false);
      }
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setEditing(true);
        setOpen(true);
      }
      return;
    }
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(rows[highlighted]);
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlighted(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlighted(rows.length - 1);
    }
  };

  const hasValue = municipalityWide || Boolean(facilityId) || Boolean(facilityName);

  return (
    <div ref={wrapRef} className="relative mt-1.5">
      <div
        className={`flex w-full items-center gap-2 rounded-btn border bg-white px-3.5 py-2.5 transition-colors focus-within:border-brand-blue dark:bg-input ${
          error ? "border-brand-danger" : "border-brand-border dark:border-border"
        }`}
      >
        <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={controlValue}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="facility-field-listbox"
          aria-activedescendant={open && rows[highlighted] ? `facility-option-${highlighted}` : undefined}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setEditing(true);
            setOpen(true);
          }}
          onFocus={() => {
            setEditing(true);
            setQuery("");
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70 dark:text-foreground"
        />
        {hasValue && (
          <button
            type="button"
            onClick={clear}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-gray transition-colors hover:text-brand-ink"
            aria-label="Clear facility"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-btn border border-brand-border bg-white shadow-float dark:border-border dark:bg-input">
          <ul id="facility-field-listbox" role="listbox" className="max-h-64 overflow-y-auto py-1">
            {rows.map((row, i) => {
              const active = i === highlighted;
              const base = `flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                active ? "bg-brand-light dark:bg-hover" : "hover:bg-brand-bg dark:hover:bg-hover"
              }`;
              if (row.kind === "muni") {
                return (
                  <li key={row.key} role="option" aria-selected={active} id={`facility-option-${i}`}>
                    <button type="button" onMouseEnter={() => setHighlighted(i)} onClick={() => commit(row)} className={base}>
                      <span className="flex items-center gap-2 text-sm font-medium text-brand-ink">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-brand-blue" />
                        Municipality-wide / RHU-wide (no specific facility)
                      </span>
                      {municipalityWide && <Check className="h-3.5 w-3.5 shrink-0 text-brand-blue" />}
                    </button>
                  </li>
                );
              }
              if (row.kind === "facility") {
                const f = row.facility;
                const tl = typeLabel(f.type);
                return (
                  <li key={row.key} role="option" aria-selected={active} id={`facility-option-${i}`}>
                    <button type="button" onMouseEnter={() => setHighlighted(i)} onClick={() => commit(row)} className={base}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm text-brand-ink">{f.name}</span>
                        {tl && (
                          <span className="shrink-0 rounded-full bg-brand-blue/10 px-1.5 py-0.5 text-xs font-medium text-brand-blue">{tl}</span>
                        )}
                      </span>
                      {String(f.id) === String(facilityId) && <Check className="h-3.5 w-3.5 shrink-0 text-brand-blue" />}
                    </button>
                  </li>
                );
              }
              return (
                <li key={row.key} role="option" aria-selected={active} id={`facility-option-${i}`}>
                  <button type="button" onMouseEnter={() => setHighlighted(i)} onClick={() => commit(row)} className={base}>
                    <span className="flex items-center gap-2 text-sm font-medium text-brand-blue">
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      Use new facility &ldquo;{row.name}&rdquo;
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
