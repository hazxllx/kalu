import React, { useEffect, useRef, useState } from "react";
import { Clock, ChevronDown } from "lucide-react";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 00..55 in 5-min steps
const ITEM_H = 24; // px — keep in sync with the h-6 option buttons

const toParts = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":");
  const hour = parseInt(h, 10);
  const minute = parseInt(m, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return { hour: 9, minute: 0, ampm: "AM" };
  return {
    hour: hour % 12 === 0 ? 12 : hour % 12,
    minute,
    ampm: hour >= 12 ? "PM" : "AM",
  };
};

const toHHMM = (hour, minute, ampm) => {
  let h = hour % 12;
  if (ampm === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const toDisplay = (hhmm) => {
  const { hour, minute, ampm } = toParts(hhmm);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${ampm}`;
};

/**
 * Compact Hour / Minute / AM-PM time picker.
 *
 * Replaces the browser's oversized native time-input dropdown with a small
 * popover aligned directly below the field: three slim columns (Hour,
 * Minute in 5-minute steps, AM/PM) plus a Done button. Selecting a minute
 * applies the time and closes the popover; Escape and outside clicks close
 * it without closing the surrounding modal. Never overflows the viewport —
 * the popover is width-locked to its field.
 *
 * @param {string} props.value 24-hour "HH:MM" string (e.g. "09:00")
 * @param (hhmm: string) => void props.onChange
 * @param {boolean} [props.error] show the invalid (red) border
 */
export default function TimePicker({ value, onChange, error = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const hourListRef = useRef(null);
  const minuteListRef = useRef(null);
  const { hour, minute, ampm } = toParts(value);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Center the highlighted options whenever the popover is open.
  useEffect(() => {
    if (!open) return;
    const center = (list, index) => {
      if (list) list.scrollTop = Math.max(0, index * ITEM_H - list.clientHeight / 2 + ITEM_H / 2);
    };
    center(hourListRef.current, HOURS.indexOf(hour));
    center(minuteListRef.current, Math.round(minute / 5));
  }, [open, hour, minute]);

  const onKeyDown = (e) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation(); // close the picker only, not the surrounding modal
      setOpen(false);
    }
  };

  const selectHour = (h) => onChange(toHHMM(h, minute, ampm));
  const selectMinute = (m) => {
    onChange(toHHMM(hour, m, ampm));
    setOpen(false);
  };
  const selectAmPm = (ap) => onChange(toHHMM(hour, minute, ap));

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-btn border bg-white px-3 py-2.5 text-left text-sm outline-none transition-colors focus:border-brand-blue ${
          error ? "border-red-400 bg-red-50/40" : "border-brand-border"
        }`}
      >
        <Clock className="h-4 w-4 shrink-0 text-brand-gray" />
        <span className={value ? "font-medium text-brand-ink" : "text-brand-gray/70"}>
          {value ? toDisplay(value) : "Select time..."}
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-brand-gray transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Select time"
          className="absolute left-0 top-full z-30 mt-1.5 w-full min-w-[212px] rounded-btn border border-brand-border bg-white p-2.5 shadow-float"
        >
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-brand-gray">Hour</p>
              <div ref={hourListRef} className="max-h-[120px] overflow-y-auto">
                {HOURS.map((h) => (
                  <button
                    type="button"
                    key={h}
                    onClick={() => selectHour(h)}
                    className={`flex h-6 w-full items-center justify-center rounded text-xs font-medium transition-colors ${
                      h === hour ? "bg-brand-blue text-white" : "text-brand-ink hover:bg-brand-bg"
                    }`}
                  >
                    {String(h).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-brand-gray">Minute</p>
              <div ref={minuteListRef} className="max-h-[120px] overflow-y-auto">
                {MINUTES.map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => selectMinute(m)}
                    className={`flex h-6 w-full items-center justify-center rounded text-xs font-medium transition-colors ${
                      m === minute ? "bg-brand-blue text-white" : "text-brand-ink hover:bg-brand-bg"
                    }`}
                  >
                    {String(m).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-brand-gray">AM / PM</p>
              <div className="space-y-1.5 pt-1">
                {["AM", "PM"].map((ap) => (
                  <button
                    type="button"
                    key={ap}
                    onClick={() => selectAmPm(ap)}
                    className={`flex h-9 w-full items-center justify-center rounded text-xs font-semibold transition-colors ${
                      ap === ampm ? "bg-brand-blue text-white" : "text-brand-ink hover:bg-brand-bg"
                    }`}
                  >
                    {ap}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 w-full rounded-btn bg-brand-light py-1.5 text-xs font-semibold text-brand-blue transition-colors hover:bg-brand-blue/15"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
