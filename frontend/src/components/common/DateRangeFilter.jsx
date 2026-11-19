import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

export const matchesDateRange = (value, from, to) => {
  const date = String(value || "").slice(0, 10);
  if (from && (!date || date < from)) return false;
  if (to && (!date || date > to)) return false;
  return true;
};

const toDate = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const toValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDate = (value, options = { month: "short", day: "numeric", year: "numeric" }) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString("en-PH", options) : "";
};

export default function DateRangeFilter({ from, to, onFromChange, onToChange, className = "", portal = false }) {
  const active = Boolean(from || to);
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from || "");
  const [draftTo, setDraftTo] = useState(to || "");
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initial = toDate(from) || toDate(to) || new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const popoverId = useId();

  const updatePopoverPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(336, window.innerWidth - 32);
    const estimatedHeight = 430;
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
    const below = rect.bottom + 8;
    const top = below + estimatedHeight <= window.innerHeight ? below : Math.max(8, rect.top - estimatedHeight - 8);
    setPopoverPosition({ left, top, width });
  };

  useEffect(() => {
    if (!open) return undefined;
    setDraftFrom(from || "");
    setDraftTo(to || "");
    const initial = toDate(from) || toDate(to) || new Date();
    setVisibleMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
    if (portal) updatePopoverPosition();
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onViewportChange = () => { if (portal) updatePopoverPosition(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, from, to, portal]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const start = new Date(firstDay);
    start.setDate(1 - firstDay.getDay());
    const weeks = firstDay.getDay() + new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate() > 35 ? 6 : 5;
    return Array.from({ length: weeks * 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [visibleMonth]);

  const onSelectDate = (value) => {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(value);
      setDraftTo("");
      return;
    }
    if (value < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(value);
    } else {
      setDraftTo(value);
    }
  };

  const selectionLabel = from && to ? `${formatDate(from)} – ${formatDate(to)}`
    : from ? `From ${formatDate(from)}`
    : to ? `Through ${formatDate(to)}`
    : "Select date range";
  const summary = draftFrom && draftTo
    ? `Range: ${formatDate(draftFrom)} – ${formatDate(draftTo)}`
    : draftFrom ? `Start: ${formatDate(draftFrom)} · Choose an end date`
    : "Select a start and end date";
  const monthLabel = visibleMonth.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const monthOptions = Array.from({ length: 12 }, (_, month) => new Date(2020, month, 1).toLocaleDateString("en-PH", { month: "long" }));
  const currentYear = new Date().getFullYear();
  const firstYear = Math.min(currentYear - 30, visibleMonth.getFullYear());
  const lastYear = Math.max(currentYear + 5, visibleMonth.getFullYear());
  const yearOptions = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);

  const moveMonth = (amount) => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const clearDates = () => {
    setDraftFrom("");
    setDraftTo("");
    onFromChange("");
    onToChange("");
    setOpen(false);
  };
  const applyRange = () => {
    onFromChange(draftFrom);
    onToChange(draftTo);
    setOpen(false);
  };

  const popover = open && (
    <div
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-label="Choose date range"
      style={portal ? (popoverPosition || { visibility: "hidden" }) : undefined}
      className={`${portal ? "fixed z-[100]" : "absolute left-0 top-full z-40 mt-2"} w-[min(21rem,calc(100vw-2rem))] rounded-lg border border-brand-border bg-white p-4 shadow-xl dark:border-border dark:bg-card`}
    >
          <div className="flex h-9 items-center justify-between gap-1">
            <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month" className="rounded p-1.5 text-brand-gray hover:bg-brand-bg hover:text-brand-ink dark:hover:bg-muted dark:hover:text-foreground">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="flex min-w-0 items-center gap-1.5" aria-label={monthLabel}>
              <select
                value={visibleMonth.getMonth()}
                aria-label="Calendar month"
                onChange={(event) => setVisibleMonth((current) => new Date(current.getFullYear(), Number(event.target.value), 1))}
                className="min-w-0 rounded border border-transparent bg-transparent px-1 py-1 text-sm font-medium text-brand-ink outline-none hover:border-brand-border focus:border-brand-blue dark:text-foreground dark:hover:border-border"
              >
                {monthOptions.map((month, index) => <option key={month} value={index}>{month}</option>)}
              </select>
              <select
                value={visibleMonth.getFullYear()}
                aria-label="Calendar year"
                onChange={(event) => setVisibleMonth((current) => new Date(Number(event.target.value), current.getMonth(), 1))}
                className="rounded border border-transparent bg-transparent px-1 py-1 text-sm font-medium text-brand-ink outline-none hover:border-brand-border focus:border-brand-blue dark:text-foreground dark:hover:border-border"
              >
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => moveMonth(1)} aria-label="Next month" className="rounded p-1.5 text-brand-gray hover:bg-brand-bg hover:text-brand-ink dark:hover:bg-muted dark:hover:text-foreground">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 text-center text-xs font-medium text-brand-gray" aria-hidden="true">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day} className="py-1.5">{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-1" role="grid" aria-label={monthLabel}>
            {calendarDays.map((date) => {
              const value = toValue(date);
              const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
              const isStart = value === draftFrom;
              const isEnd = value === draftTo;
              const inRange = draftFrom && draftTo && value > draftFrom && value < draftTo;
              const selected = isStart || isEnd;
              return (
                <button
                  key={value}
                  type="button"
                  role="gridcell"
                  aria-pressed={selected}
                  aria-label={date.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  onClick={() => onSelectDate(value)}
                  className={`mx-auto flex h-8 w-9 items-center justify-center rounded-md text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue ${
                    selected ? "bg-brand-blue font-semibold text-white" : inRange ? "bg-brand-blue/10 text-brand-ink dark:bg-brand-blue/20 dark:text-foreground" : isCurrentMonth ? "text-brand-ink hover:bg-brand-bg dark:text-foreground dark:hover:bg-muted" : "text-brand-gray/50 hover:bg-brand-bg dark:text-muted-foreground dark:hover:bg-muted"
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <p className="mt-3 rounded bg-brand-bg px-2.5 py-2 text-xs text-brand-ink dark:bg-muted dark:text-foreground" aria-live="polite">{summary}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={clearDates} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-btn border border-brand-border px-3 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:border-border dark:hover:bg-muted">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
            </button>
            <button type="button" onClick={applyRange} className="h-9 rounded-btn bg-brand-blue px-3 text-sm font-medium text-white hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Apply</button>
          </div>
        </div>
  );

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <label className="block min-w-0 text-sm font-medium text-brand-gray">
        Date Range
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={`Date Range: ${selectionLabel}`}
          onClick={() => {
            if (portal && !open) updatePopoverPosition();
            setOpen((value) => !value);
          }}
          className="mt-1 flex h-10 w-full min-w-0 items-center justify-between rounded-btn border border-brand-border bg-white px-3 text-left text-sm font-normal text-brand-gray outline-none transition hover:border-brand-blue focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 dark:border-border dark:bg-input dark:text-foreground"
        >
          <span className={active ? "truncate text-brand-ink dark:text-foreground" : "truncate"}>{selectionLabel}</span>
          <CalendarDays className="ml-3 h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
        </button>
      </label>
      {popover && (portal ? createPortal(popover, document.body) : popover)}
    </div>
  );
}
