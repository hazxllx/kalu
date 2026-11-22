import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * @param {Object} props
 * @param {string} [props.label] Field label (kept consistent with sibling inputs)
 * @param {boolean} [props.required] Adds the red required asterisk
 * @param {string} [props.value] Currently selected value
 * @param {(value: string) => void} props.onChange
 * @param {Array<string|{value:string,label:string}>} [props.options] Selectable options
 * @param {string} [props.placeholder] Shown before anything is chosen
 * @param {string} [props.emptyText] Shown when the filter has no matches
 * @param {string} [props.error] Inline validation message
 * @param {boolean} [props.disabled] Prevents searching, clearing, and changing the selection
 * @param {number} [props.maxResults] Scrollable result cap (panel scrolls if exceeded)
 * @param {boolean} [props.portalDropdown] Render the menu outside overflow-clipped containers
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
  disabled = false,
  maxResults = 6,
  portalDropdown = false,
}) {
  const items = useMemo(() => normalizeOptions(options), [options]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState(null);

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
      if (!wrapRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open || !portalDropdown) return undefined;
    const updatePosition = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const below = viewportHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const estimatedHeight = Math.min(256, Math.max(48, Math.min(results.length, maxResults) * 44 + 8));
      const placeAbove = below < estimatedHeight && above > below;
      const availableHeight = placeAbove ? above : below;
      setMenuPosition({
        left: rect.left,
        width: rect.width,
        ...(placeAbove
          ? { bottom: viewportHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
        maxHeight: Math.max(80, Math.min(256, availableHeight)),
        zIndex: 100,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, portalDropdown, results.length, maxResults]);

  const select = (option) => {
    if (disabled) return;
    onChange(option.value);
    setQuery("");
    setOpen(false);
  };

  const clear = () => {
    if (disabled) return;
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
  const dropdown = open && !disabled ? (
    <div
      ref={menuRef}
      style={portalDropdown ? (menuPosition || { visibility: "hidden" }) : undefined}
      className={`${portalDropdown ? "fixed" : "absolute left-0 right-0 top-full z-30 mt-1.5"} max-w-full overflow-hidden rounded-btn border border-brand-border bg-white shadow-float dark:border-border dark:bg-popover`}
    >
      {results.length === 0 ? (
        <p className="px-3 py-3 text-sm text-brand-gray dark:text-muted-foreground">{emptyText}</p>
      ) : (
        <ul id="searchable-select-listbox" role="listbox" className="max-h-64 overflow-y-auto py-1">
          {results.slice(0, maxResults).map((o, i) => (
            <li key={o.value} role="option" aria-selected={i === highlighted} id={`searchable-option-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => select(o)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 min-h-[44px] sm:min-h-0 text-left transition-colors ${
                  i === highlighted ? "bg-brand-light dark:bg-card-nested" : "hover:bg-brand-bg dark:hover:bg-hover"
                }`}
              >
                <span className="truncate text-sm font-medium text-brand-ink dark:text-foreground">{o.label}</span>
                {o.value === value && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-brand-blue dark:text-blue-400" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  return (
    <div>
      {label && (
        <label className="text-sm font-medium text-brand-ink dark:text-foreground">
          {label}
          {required && <span className="text-brand-danger dark:text-red-400"> *</span>}
        </label>
      )}
      <div ref={wrapRef} className="relative mt-1.5">
        <div
          className={`flex h-11 w-full items-center gap-2 rounded-input border bg-white dark:bg-input px-3.5 transition-colors focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/15 dark:focus-within:border-blue-400 dark:focus-within:ring-blue-400/15 ${
            error
              ? "border-brand-danger bg-red-50/40 focus-within:border-brand-danger focus-within:ring-red-500/15 dark:border-red-500 dark:bg-red-950/30 dark:focus-within:border-red-500 dark:focus-within:ring-red-500/15"
              : "border-[#CBD5E1] dark:border-border"
          }`}
        >
          <Search className="h-4 w-4 shrink-0 text-brand-gray dark:text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={controlValue}
            role="combobox"
            aria-invalid={Boolean(error)}
            aria-disabled={disabled}
            readOnly={disabled}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls="searchable-select-listbox"
            aria-activedescendant={
              open && results[highlighted] ? `searchable-option-${highlighted}` : undefined
            }
            placeholder={placeholder}
            onChange={(e) => {
              if (disabled) return;
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (disabled) return;
              if (showSelected) setQuery("");
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            className={`w-full min-w-0 bg-transparent text-sm text-brand-ink dark:text-foreground outline-none placeholder:text-brand-gray/70 dark:placeholder:text-muted-foreground/70 ${disabled ? "cursor-not-allowed" : ""}`}
            disabled={disabled}
          />
          {(value || query) && !disabled && (
            <button
              type="button"
              onClick={clear}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-gray dark:text-muted-foreground transition-colors hover:text-brand-ink dark:hover:text-foreground touch-target-sm"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {dropdown && (portalDropdown ? createPortal(dropdown, document.body) : dropdown)}
      </div>
      {error && <p className="mt-1 text-xs text-brand-danger dark:text-red-400">{error}</p>}
    </div>
  );
}
