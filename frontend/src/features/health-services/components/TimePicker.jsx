import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, Check } from "lucide-react";

/**
 * Compact, reliable 12-hour time field used by the Add Health Service modal
 * (Start Time, End Time and the Registration Deadline time).
 *
 * The user can EITHER type the time directly (e.g. "8:30 AM", "08:30", "14:30",
 * "2 pm", "0830") OR open the small hour/minute/AM-PM picker with the clock
 * button — the two stay synchronized. Typed values are validated when the user
 * leaves the field (on blur) and are never silently rewritten: an unparseable
 * entry keeps what the user typed and surfaces a message (reported to the
 * parent via `onParseError`) instead of guessing.
 *
 * The value contract is a 24-hour "HH:MM" string (empty when unset), so
 * persistence, validation and display elsewhere are unchanged and no time shift
 * is introduced. The picker panel renders in a body-level portal with fixed
 * positioning so it is never clipped by the modal body or fixed footer.
 *
 * @param {Object} props
 * @param {string} props.value               24-hour "HH:MM" (or "")
 * @param {(hhmm: string) => void} props.onChange
 * @param {(message: string) => void} [props.onParseError]  "" when valid/empty
 * @param {string} [props.placeholder]
 * @param {boolean} [props.error]            Error styling flag (red border)
 * @param {string} [props.ariaLabel]
 * @param {string} [props.className]         Classes for the control (match date inputs)
 */
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ["AM", "PM"];
const PANEL_HEIGHT = 268;
const pad = (n) => String(n).padStart(2, "0");

const parse = (hhmm) => {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute: m, period: h >= 12 ? "PM" : "AM" };
};
const to24 = (hour12, minute, period) => {
  let h = hour12 % 12;
  if (period === "PM") h += 12;
  return `${pad(h)}:${pad(minute)}`;
};
export const formatTimeLabel = (hhmm) => {
  const p = parse(hhmm);
  if (!p) return "";
  return `${p.hour12}:${pad(p.minute)} ${p.period}`;
};

/**
 * Parse a freely-typed time into canonical 24-hour "HH:MM", or null.
 * Accepts: "8:30 AM", "08:30am", "2 pm", "14:30", "930", "0830".
 */
export const parseTypedTime = (raw) => {
  const s = String(raw).trim().toUpperCase().replace(/\./g, "");
  if (!s) return "";
  // 3-4 digit military time (e.g. 930 -> 9:30, 0830 -> 08:30, 1430 -> 14:30).
  let m = s.match(/^(\d{1,2})(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    return h < 24 && mm < 60 ? `${pad(h)}:${pad(mm)}` : null;
  }
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2] != null ? Number(m[2]) : 0;
  const ap = m[3];
  if (mm > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === "PM" ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return `${pad(h)}:${pad(mm)}`;
};

const INVALID_MESSAGE = "Enter a valid time (e.g. 8:30 AM).";

export default function TimePicker({
  value = "",
  onChange,
  onParseError,
  placeholder = "Select or type a time",
  error = false,
  ariaLabel = "Time",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const hourColRef = useRef(null);
  const minColRef = useRef(null);
  const periodColRef = useRef(null);
  const selHourRef = useRef(null);
  const selMinRef = useRef(null);
  const selPeriodRef = useRef(null);

  const selected = parse(value);
  const draft = selected || { hour12: 9, minute: 0, period: "AM" };
  const display = editing ? text : formatTimeLabel(value);

  const reportError = (msg) => {
    if (onParseError) onParseError(msg);
  };

  const pick = (part, v) => {
    const next = { ...draft, [part]: v };
    const hhmm = to24(next.hour12, next.minute, next.period);
    onChange(hhmm);
    setText(formatTimeLabel(hhmm));
    reportError("");
  };

  const commitText = () => {
    const parsed = parseTypedTime(text);
    if (parsed === "") {
      onChange("");
      reportError("");
    } else if (parsed) {
      onChange(parsed);
      setText(formatTimeLabel(parsed));
      reportError("");
    } else {
      // Invalid: keep what the user typed and surface a message, don't rewrite.
      reportError(INVALID_MESSAGE);
    }
  };

  const computePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 232);
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const placeAbove = spaceBelow < PANEL_HEIGHT + 8 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(PANEL_HEIGHT, (placeAbove ? spaceAbove : spaceBelow) - 12);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
    if (left < 8) left = 8;
    const top = placeAbove ? Math.max(8, r.top - maxHeight - 6) : r.bottom + 6;
    setPos({ top, left, width, maxHeight, placeAbove });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    computePosition();
    const onScroll = () => computePosition();
    const onResize = () => computePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !pos) return undefined;
    const raf = requestAnimationFrame(() => {
      const center = (colRef, btnRef) => {
        const col = colRef.current;
        const btn = btnRef.current;
        if (col && btn) col.scrollTop = btn.offsetTop - col.clientHeight / 2 + btn.clientHeight / 2;
      };
      center(hourColRef, selHourRef);
      center(minColRef, selMinRef);
      center(periodColRef, selPeriodRef);
    });
    return () => cancelAnimationFrame(raf);
  }, [open, pos]);

  const colBtn = (active) =>
    `w-full rounded px-2 py-1.5 text-center text-sm transition-colors ${
      active ? "bg-brand-blue text-white" : "text-brand-ink hover:bg-brand-bg dark:hover:bg-hover"
    }`;

  return (
    <>
      <div
        ref={triggerRef}
        className={`${className} flex items-center justify-between gap-2 ${error ? "border-brand-danger" : ""}`}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={display}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={error || undefined}
          autoComplete="off"
          onFocus={() => {
            setEditing(true);
            setText(formatTimeLabel(value));
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
              setOpen(false);
            }
          }}
          className="w-full min-w-0 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70 dark:text-foreground"
        />
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          aria-label={`Open ${ariaLabel.toLowerCase()} picker`}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="shrink-0 text-brand-gray transition-colors hover:text-brand-blue"
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`${ariaLabel} picker`}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          className="z-[120] flex flex-col overflow-hidden rounded-btn border border-brand-border bg-white shadow-float dark:border-border dark:bg-input"
        >
          <div className="grid grid-cols-3 gap-1 border-b border-brand-border px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-brand-gray dark:border-border">
            <span>Hour</span>
            <span>Min</span>
            <span>AM/PM</span>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-3 gap-1 p-1.5">
            <ul ref={hourColRef} className="relative max-h-full space-y-0.5 overflow-y-auto pr-0.5">
              {HOURS.map((h) => {
                const active = draft.hour12 === h;
                return (
                  <li key={h}>
                    <button type="button" ref={active ? selHourRef : null} onClick={() => pick("hour12", h)} className={colBtn(active)}>
                      {h}
                    </button>
                  </li>
                );
              })}
            </ul>
            <ul ref={minColRef} className="relative max-h-full space-y-0.5 overflow-y-auto pr-0.5">
              {MINUTES.map((m) => {
                const active = draft.minute === m;
                return (
                  <li key={m}>
                    <button type="button" ref={active ? selMinRef : null} onClick={() => pick("minute", m)} className={colBtn(active)}>
                      {pad(m)}
                    </button>
                  </li>
                );
              })}
            </ul>
            <ul ref={periodColRef} className="relative max-h-full space-y-0.5 overflow-y-auto pr-0.5">
              {PERIODS.map((p) => {
                const active = draft.period === p;
                return (
                  <li key={p}>
                    <button type="button" ref={active ? selPeriodRef : null} onClick={() => pick("period", p)} className={colBtn(active)}>
                      {p}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-brand-border px-3 py-2 dark:border-border">
            <span className="text-sm font-medium text-brand-ink dark:text-foreground">
              {value ? formatTimeLabel(value) : "—"}
            </span>
            <button
              type="button"
              onClick={() => {
                if (!value) {
                  const hhmm = to24(draft.hour12, draft.minute, draft.period);
                  onChange(hhmm);
                  setText(formatTimeLabel(hhmm));
                  reportError("");
                }
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-dark"
            >
              <Check className="h-3.5 w-3.5" /> Done
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
