import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import { addYears, format, isValid, parseISO } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import "react-day-picker/dist/style.css";

/**
 * Normalize free-typed date text to a canonical ISO date ("yyyy-MM-dd").
 *
 * Accepts "yyyy-MM-dd" and "MM/dd/yyyy" (and single-digit month/day), and
 * rejects impossible calendar dates (e.g. 2020-02-31). Returns "" when the
 * text is not yet a complete, valid date so a half-typed value never commits.
 */
export function normalizeTypedDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  let y;
  let m;
  let d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [, y, m, d] = match;
  } else {
    match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return "";
    [, m, d, y] = match;
  }
  y = Number(y);
  m = Number(m);
  d = Number(d);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return "";
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * KALUSAGAP date picker.
 *
 * Replaces the browser's native date input, whose popup cannot be positioned
 * or themed — inside a card with `overflow-hidden` it would flip upward and
 * cover the page heading. This component renders the calendar in a PORTAL with
 * fixed positioning, so it:
 *
 *   - is never clipped by an ancestor's overflow/z-index,
 *   - opens BELOW the field and flips ABOVE only when there is not enough room
 *     below (viewport-aware), staying on-screen at any size,
 *   - is clamped to the viewport width (usable on mobile),
 *   - closes on outside click / Escape (the surrounding modal stays open),
 *   - offers Clear / Today, month + year dropdowns and disabled-date styling.
 *
 * @param {Object} props
 * @param {string} props.value ISO date "yyyy-MM-dd" ("" when empty)
 * @param {(value: string) => void} props.onChange receives ISO date, or "" when cleared
 * @param {string} [props.min] earliest selectable ISO date
 * @param {string} [props.max] latest selectable ISO date
 * @param {boolean} [props.error] invalid (red) border
 * @param {string} [props.placeholder] placeholder label shown when empty
 * @param {boolean} [props.disabled] disables field interaction
 * @param {string} [props.id] input/button id
 * @param {string} [props.ariaDescribedby] ID of the field's validation description
 * @param {boolean} [props.ariaInvalid] whether the date value is invalid
 * @param {(event: React.FocusEvent<HTMLInputElement>) => void} [props.onBlur] blur handler for the typeable input
 * @param {(raw: string) => void} [props.onInvalidInput] receives incomplete or malformed typed input
 * @param {string} [props.className] extra classes for wrapper
 * @param {boolean} [props.typeable] also allow typing the date directly (the
 *   calendar is still available via the trailing button). The field accepts
 *   "yyyy-MM-dd" or "MM/dd/yyyy"; a complete valid date commits automatically.
 */
export default function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Select date...",
  disabled = false,
  error = false,
  id,
  ariaDescribedby = undefined,
  ariaInvalid = undefined,
  onBlur = undefined,
  onInvalidInput = undefined,
  className = "",
  typeable = false,
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState("bottom");
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  // Local text buffer for the typeable field so a half-typed value stays on
  // screen while only COMPLETE, valid dates are committed to `value`.
  const [typed, setTyped] = useState(value || "");

  // Keep the text field in sync when `value` is set externally (calendar pick,
  // reset, or a parent update) without clobbering what the user is typing.
  useEffect(() => {
    setTyped((prev) => (normalizeTypedDate(prev) === (value || "") ? prev : value || ""));
  }, [value]);

  const selected = toDate(value);
  const minDate = toDate(min);
  const maxDate = toDate(max);
  const today = new Date();

  // Keep the popover anchored to its field while open (scroll/resize aware).
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popWidth = Math.min(Math.max(rect.width, 300), window.innerWidth - 16);
    const popHeight = 380; // calendar + footer, generous estimate
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < popHeight + 16 && spaceAbove > spaceBelow;

    let left = rect.left;
    if (left + popWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - popWidth - 8);
    }

    setPlacement(openUp ? "top" : "bottom");
    setCoords({
      top: openUp ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(8, left),
      width: popWidth,
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    reposition();
    const onMove = () => reposition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, reposition]);

  // Outside click + Escape close only the picker (not the surrounding modal).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const disabledMatchers = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  const commit = (date) => {
    onChange(date ? format(date, "yyyy-MM-dd") : "");
    setOpen(false);
  };

  // Typed input: keep the raw text locally; commit only a complete, valid date.
  // An empty field clears the value; a partial/invalid entry commits "" so the
  // parent's required/validity check can flag it (the typed text is preserved).
  const onType = (e) => {
    const raw = e.target.value;
    setTyped(raw);
    if (raw.trim() === "") {
      onChange("");
      return;
    }
    const normalized = normalizeTypedDate(raw);
    if (normalized) onChange(normalized);
    else onInvalidInput?.(raw);
  };

  const todayDisabled =
    (minDate && today < startOfDay(minDate)) || (maxDate && today > startOfDay(maxDate));

  return (
    <div className={`relative ${className}`}>
      {typeable ? (
        <div
          ref={triggerRef}
          className={`flex w-full items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all duration-200 ${
            error
              ? "border-brand-danger bg-rose-50/50 focus-within:border-brand-danger focus-within:ring-4 focus-within:ring-brand-danger/10"
              : "border-slate-200 bg-slate-50/60 hover:border-slate-300 focus-within:border-brand-blue focus-within:bg-white focus-within:ring-4 focus-within:ring-brand-blue/10"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <input
            id={id}
            aria-describedby={ariaDescribedby}
            aria-invalid={ariaInvalid}
            type="text"
            inputMode="numeric"
            autoComplete="bday"
            disabled={disabled}
            value={typed}
            onChange={onType}
            onBlur={onBlur}
            placeholder="YYYY-MM-DD"
            aria-label={placeholder}
            className="w-full bg-transparent text-brand-ink outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label="Open calendar"
            className="shrink-0 text-slate-400 transition-colors hover:text-brand-blue"
          >
            <CalendarIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          id={id}
          aria-describedby={ariaDescribedby}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`flex w-full items-center gap-2 rounded-xl border px-4 py-2.5 text-left text-sm outline-none transition-all duration-200 ${
            error
              ? "border-brand-danger bg-rose-50/50 focus:border-brand-danger focus:ring-4 focus:ring-brand-danger/10"
              : "border-slate-200 bg-slate-50/60 hover:border-slate-300 focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/10"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <span className={`truncate ${selected ? "text-brand-ink" : "text-slate-400"}`}>
            {selected ? format(selected, "MMM d, yyyy") : placeholder}
          </span>
          <CalendarIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      )}

      {open &&
        coords &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Select date"
            className="kalusagap-datepicker fixed z-[90] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl"
            style={{
              top: coords.top,
              left: coords.left,
              width: coords.width,
              transform: placement === "top" ? "translateY(-100%)" : undefined,
            }}
          >
            <DayPicker
              mode="single"
              selected={selected}
              onSelect={commit}
              defaultMonth={selected || (maxDate && maxDate < today ? maxDate : today)}
              disabled={disabledMatchers.length ? disabledMatchers : undefined}
              fromDate={minDate || new Date(1900, 0, 1)}
              toDate={maxDate || addYears(today, 10)}
              captionLayout="dropdown"
              showOutsideDays
            />
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={() => commit(null)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-ink"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={Boolean(todayDisabled)}
                onClick={() => commit(today)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-blue transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50"
              >
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Parse an ISO date string (or Date) into a valid Date, else undefined. */
function toDate(value) {
  if (!value) return undefined;
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? date : undefined;
}

/** Midnight of the given date (for comparing whole days). */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
