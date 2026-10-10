import React, { useRef, useState } from "react";
import { Calendar } from "lucide-react";

/**
 * Date field that accepts a typed `DD/MM/YYYY` value AND keeps the browser's
 * native date picker as an optional, synchronized alternative (opened with the
 * calendar button). Typed entries are validated when the user leaves the field
 * (on blur) and are never silently rewritten — an invalid entry keeps what the
 * user typed and reports a message via `onParseError` instead of guessing.
 *
 * The value contract is a canonical "YYYY-MM-DD" string (empty when unset), so
 * backend storage, timezone behavior and sibling validation stay unchanged.
 *
 * @param {Object} props
 * @param {string} props.value               "YYYY-MM-DD" (or "")
 * @param {(iso: string) => void} props.onChange
 * @param {(message: string) => void} [props.onParseError]  "" when valid/empty
 * @param {string} [props.min]               Minimum "YYYY-MM-DD" for the native picker
 * @param {string} [props.max]               Maximum "YYYY-MM-DD" for the native picker
 * @param {boolean} [props.error]            Error styling flag (red border)
 * @param {string} [props.ariaLabel]
 * @param {string} [props.className]         Classes for the control (match other inputs)
 */
const pad = (n) => String(n).padStart(2, "0");

export const isoToDMY = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/** Parse a typed "DD/MM/YYYY" into canonical "YYYY-MM-DD", or null. */
export const parseDMY = (raw) => {
  const s = String(raw).trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
};

const INVALID_MESSAGE = "Enter a valid date (DD/MM/YYYY).";

export default function DateField({
  value = "",
  onChange,
  onParseError,
  min,
  max,
  error = false,
  ariaLabel = "Date",
  placeholder = "DD/MM/YYYY",
  className = "",
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const nativeRef = useRef(null);

  const display = editing ? text : isoToDMY(value);
  const reportError = (msg) => {
    if (onParseError) onParseError(msg);
  };

  const commitText = () => {
    const parsed = parseDMY(text);
    if (parsed === "") {
      onChange("");
      reportError("");
    } else if (parsed) {
      onChange(parsed);
      setText(isoToDMY(parsed));
      reportError("");
    } else {
      reportError(INVALID_MESSAGE);
    }
  };

  const openNative = () => {
    const el = nativeRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  return (
    <div className={`${className} flex items-center justify-between gap-2 ${error ? "border-brand-danger" : ""}`}>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        autoComplete="off"
        onFocus={() => {
          setEditing(true);
          setText(isoToDMY(value));
          reportError("");
        }}
        onChange={(e) => {
          setText(e.target.value);
          reportError("");
        }}
        onBlur={() => {
          setEditing(false);
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText();
          }
        }}
        className="w-full min-w-0 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70 dark:text-foreground"
      />
      <span className="relative inline-flex shrink-0">
        <button
          type="button"
          onClick={openNative}
          aria-label={`Open ${ariaLabel.toLowerCase()} picker`}
          className="text-brand-gray transition-colors hover:text-brand-blue"
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
        </button>
        {/* Native date picker kept as a synchronized, cross-platform fallback. */}
        <input
          ref={nativeRef}
          type="date"
          value={value || ""}
          min={min}
          max={max}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            onChange(e.target.value);
            setText(isoToDMY(e.target.value));
            reportError("");
          }}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </span>
    </div>
  );
}
