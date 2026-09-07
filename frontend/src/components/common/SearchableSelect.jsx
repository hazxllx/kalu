import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Check } from "lucide-react";

const normalizeOptions = (options) =>
  (options || []).map((o) =>
    typeof o === "string" || typeof o === "number"
      ? { value: String(o), label: String(o) }
      : { value: String(o.value), label: String(o.label ?? o.value) }
  );

/**
 * Reusable searchable combobox.
 *
 * Looks and behaves like a normal KALUSAGAP input (same height, border radius,
 * spacing and focus ring) but lets the user type to filter the available
 * options. Dropdown opens on focus and lists every option until the user types;
 * matching is case-insensitive. Selecting shows the chosen option in the field
 * with a clear button; the panel closes on selection, on outside click and on
 * Escape. Keyboard navigation (↑/↓/Enter) is supported.
 *
 * @param {string} label        Field label (kept consistent with sibling inputs)
 * @param {boolean} required    Adds the red required asterisk
 * @param {string} value        Currently selected value
 * @param {(v: string) => void} onChange
 * @param {Array<string|{value:string,label:string}>} options Selectable options
 * @param {string} placeholder  Shown before anything is chosen
 * @param {string} emptyText    Shown when the filter has no matches
 * @param {string} error        Inline validation message
 * @param {number} maxResults   Scrollable result cap (panel scrolls if exceeded)
 */
export default function SearchableSelect({
  label,
  required = false,
  value = "",
  onChange,
  options = [],
  placeholder = "Search...",
  emptyText = "No options found.",
  error = "",
  maxResults = 6,
}) {
  const items = useMemo(() => normalizeOptions(options), [options]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const tokens = q.split(/\s+/).filter(Boolean);
    return items.filter((o) => {
      const label = o.label.toLowerCase();
      return tokens.every((t) => label.includes(t));
    });
  }, [items, query]);

  useEffect(() => setHighlighted(0), [query, items.length]);

  // Close the dropdown when clicking outside the field.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (option) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  };

  const clear = () => {
    onChange("");
    setQuery("");
    setHighlighted(0);
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted((h) => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (results[highlighted]) select(results[highlighted]);
    } else if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted(0);
    } else if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted(results.length - 1);
    }
  };

  // When there is a chosen value and the user is not actively filtering, the
  // field simply shows the selected option; focusing starts a fresh search.
  const showSelected = value && !open;
  const controlValue = showSelected ? items.find((o) => o.value === value)?.label || value : query;

  return (
    <div>
      {label && (
        <label className="text-sm font-medium text-brand-ink">
          {label}
          {required && <span className="text-brand-danger"> *</span>}
        </label>
      )}
      <div ref={wrapRef} className="relative mt-1.5">
        <div
          className={`flex w-full items-center gap-2 rounded-input border bg-white px-3.5 py-2.5 transition-colors focus-within:border-brand-blue ${
            error ? "border-brand-danger bg-red-50/40" : "border-brand-border"
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
            aria-controls="searchable-select-listbox"
            aria-activedescendant={
              open && results[highlighted] ? `searchable-option-${highlighted}` : undefined
            }
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (showSelected) setQuery("");
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            className="w-full min-w-0 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70"
          />
          {(value || query) && (
            <button
              type="button"
              onClick={clear}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-gray transition-colors hover:text-brand-ink"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-btn border border-brand-border bg-white shadow-float">
            {results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-brand-gray">{emptyText}</p>
            ) : (
              <ul id="searchable-select-listbox" role="listbox" className="max-h-64 overflow-y-auto py-1">
                {results.slice(0, maxResults).map((o, i) => (
                  <li key={o.value} role="option" aria-selected={i === highlighted} id={`searchable-option-${i}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlighted(i)}
                      onClick={() => select(o)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                        i === highlighted ? "bg-brand-light" : "hover:bg-brand-bg"
                      }`}
                    >
                      <span className="truncate text-sm font-medium text-brand-ink">{o.label}</span>
                      {o.value === value && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}
