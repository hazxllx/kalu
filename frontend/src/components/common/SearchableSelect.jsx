import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X, Check } from "lucide-react";

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
 * @param {number} [props.maxResults] Visible rows before the panel scrolls
 * @param {boolean} [props.portalDropdown] Render the menu outside overflow-clipped containers
 * @param {string} [props.id] Unique input identifier
 * @param {string} [props.ariaLabel] Accessible name when no label is shown
 * @param {boolean} [props.compact] Match compact clinical-form input heights
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
  id,
  ariaLabel,
  compact = false,
}) {
  const generatedId = useId();
  const inputId = id || `select-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
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

  useEffect(() => {
    setHighlighted(query ? 0 : Math.max(0, items.findIndex((item) => item.value === value)));
  }, [query, open, items, value]);

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
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportWidth = viewport?.width || window.innerWidth;
      const below = viewportTop + viewportHeight - rect.bottom - 12;
      const above = rect.top - viewportTop - 12;
      const estimatedHeight = Math.min(256, Math.max(48, Math.min(results.length, maxResults) * 44 + 8));
      const placeAbove = below < estimatedHeight && above > below;
      const availableHeight = placeAbove ? above : below;
      const maxHeight = Math.max(0, Math.min(estimatedHeight, availableHeight));
      const width = Math.min(rect.width, Math.max(0, viewportWidth - 16));
      setMenuPosition({
        left: Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + viewportWidth - width - 8)),
        width,
        top: placeAbove ? rect.top - maxHeight - 6 : rect.bottom + 6,
        maxHeight,
        zIndex: 100,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open, portalDropdown, results.length, maxResults]);

  const menuReady = open && !disabled && (!portalDropdown || Boolean(menuPosition));
  useEffect(() => {
    if (menuReady) menuRef.current?.querySelector(`[data-option-index="${highlighted}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted, menuReady]);

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
    if (e.key === "Tab") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (!open && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
      setQuery("");
      setHighlighted(Math.max(0, items.findIndex((item) => item.value === value)));
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
      className={`${portalDropdown ? "fixed" : "absolute left-0 right-0 top-full z-30 mt-1.5"} max-w-full overflow-auto rounded-btn border border-brand-border bg-white text-brand-ink shadow-float dark:border-border dark:bg-card dark:text-foreground`}
    >
      {results.length === 0 ? (
        <div id={listboxId} role="listbox" aria-label={ariaLabel || label || placeholder} className="px-3 py-3 text-sm text-brand-gray">{emptyText}</div>
      ) : (
        <ul id={listboxId} role="listbox" aria-label={ariaLabel || label || placeholder} style={{ maxHeight: portalDropdown ? Math.max(0, (menuPosition?.maxHeight ?? 256) - 2) : Math.min(256, maxResults * 44 + 8) }} className="overflow-y-auto py-1">
          {results.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} id={`${listboxId}-option-${i}`} data-option-index={i}>
              <button
                 type="button"
                 tabIndex={-1}
                 onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => select(o)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 min-h-[44px] sm:min-h-0 text-left transition-colors ${
                  i === highlighted || o.value === value ? "bg-brand-light dark:bg-brand-blue/20" : "hover:bg-brand-bg dark:hover:bg-muted/50"
                }`}
              >
                <span className="truncate text-sm font-medium text-brand-ink dark:text-foreground">{o.label}</span>
                {o.value === value && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
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
        <label htmlFor={inputId} className={compact ? "text-xs font-medium text-brand-gray" : "text-sm font-medium text-brand-ink"}>
          {label}
          {required && <span className="text-brand-danger"> *</span>}
        </label>
      )}
      <div ref={wrapRef} className={`relative ${label ? "mt-1.5" : ""}`}>
        <div
          className={`flex ${compact ? "h-9 rounded-btn px-2.5" : "h-11 rounded-input px-3.5"} w-full items-center gap-2 border bg-white transition-colors focus-within:border-brand-blue dark:border-border dark:bg-card ${
            error
              ? "border-brand-danger bg-red-50/40 focus-within:border-brand-blue dark:border-brand-danger dark:bg-red-950/20"
              : "border-brand-border"
          }`}
        >
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={controlValue}
            role="combobox"
            aria-label={ariaLabel}
            aria-invalid={Boolean(error)}
            aria-disabled={disabled}
            readOnly={disabled}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls={open && !disabled ? listboxId : undefined}
            aria-activedescendant={
              open && results[highlighted] ? `${listboxId}-option-${highlighted}` : undefined
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
            className={`w-full min-w-0 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70 dark:text-foreground ${disabled ? "cursor-not-allowed" : ""}`}
            disabled={disabled}
          />
          {(value || query) && !disabled && (
            <button
              type="button"
              onClick={clear}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-gray transition-colors hover:text-brand-ink touch-target-sm"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (disabled) return;
              if (open) setOpen(false);
              else {
                inputRef.current?.focus();
                setOpen(true);
              }
            }}
            disabled={disabled}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-gray transition-colors hover:text-brand-ink disabled:cursor-not-allowed touch-target-sm"
            aria-label={`${open ? "Close" : "Open"} ${ariaLabel || label || "options"}`}
            aria-expanded={open}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>

        {dropdown && (portalDropdown ? createPortal(dropdown, document.body) : dropdown)}
      </div>
      {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}
