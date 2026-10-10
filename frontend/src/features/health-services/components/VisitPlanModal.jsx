import React, { useEffect, useState } from "react";
import { X, Loader2, Clock, CalendarDays } from "lucide-react";
import { Card } from "@/components/common/Card";
import { visitPlansApi } from "@/services/api";
import { formatWindow, formatChip } from "../lib/visitPlanFormat";

/**
 * Compact service Registration modal (max 420px, no inner scroll on mobile).
 *
 * The resident registers by committing to a DAY within the service's actual
 * availability (slot capacity is a BHW concern). The day picker shows only the
 * service's available weekdays within the next two weeks (unavailable/closed
 * days are not offered). The time window is read-only, derived from the service
 * schedule. On confirm a registration is created against the authenticated
 * resident and the selected service, and the barangay health worker is
 * notified; the resident sees a simple confirmation.
 */
export default function VisitPlanModal({ service, open, onClose, onConfirmed, showToast }) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [availability, setAvailability] = useState(null);
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open || !service) return undefined;
    let active = true;
    setLoading(true);
    setLoadError("");
    setAvailability(null);
    setSelected("");
    setNote("");
    setFormError("");
    visitPlansApi
      .availability(service.id)
      .then((res) => {
        if (!active) return;
        const data = res?.availability || {};
        setAvailability(data);
        // Preselect the first available day so a plan is two interactions away.
        if ((data.dates || []).length) setSelected(data.dates[0].date);
      })
      .catch((err) => {
        if (active) setLoadError(err?.message || "Unable to load available days.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, service]);

  if (!open || !service) return null;

  const dates = availability?.dates || [];
  const windowLabel = formatWindow(
    availability?.windowStart || service.windowStart,
    availability?.windowEnd || service.windowEnd,
  );

  const submit = async () => {
    setFormError("");
    if (!selected) return setFormError("Select a day for your visit.");
    setSubmitting(true);
    try {
      const res = await visitPlansApi.create({ serviceId: service.id, plannedDate: selected, note: note.trim() });
      onConfirmed?.(res?.plan);
      showToast?.("You're registered. Your barangay health center has been notified.");
      onClose?.();
    } catch (err) {
      setFormError(err?.message || "Could not complete your registration. Please try again.");
    } finally {
      setSubmitting(false);
    }
    return undefined;
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Register for ${service.name}`}
    >
      <Card className="flex w-full max-w-[420px] flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-brand-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-brand-ink">{service.name}</h2>
            <p className="mt-0.5 truncate text-xs text-brand-gray">{service.facilityName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn p-1.5 text-brand-gray transition-colors hover:bg-brand-bg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {windowLabel && (
            <div className="flex items-center gap-2 text-[13px] text-brand-gray">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{windowLabel}</span>
            </div>
          )}

          <div>
            <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-brand-ink">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-brand-gray" aria-hidden="true" />
              Choose a day
            </p>

            {loading ? (
              <p className="text-[13px] text-brand-gray">Loading available days…</p>
            ) : loadError ? (
              <p className="text-[13px] text-brand-danger">{loadError}</p>
            ) : dates.length === 0 ? (
              <p className="rounded-card border border-brand-border bg-brand-bg px-3 py-2.5 text-[13px] text-brand-gray">
                No open days in the next two weeks. Please check back later.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {dates.map((d) => {
                  const chip = formatChip(d.date);
                  const active = selected === d.date;
                  return (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => setSelected(d.date)}
                      aria-pressed={active}
                      className={`rounded-card border px-2 py-2 text-center transition-colors ${
                        active
                          ? "border-brand-blue bg-brand-blue text-white"
                          : "border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
                      }`}
                    >
                      <span className="block text-[11px] font-medium uppercase tracking-wide opacity-80">{chip.top}</span>
                      <span className="block text-[13px] font-semibold leading-tight">{chip.bottom}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="visit-note" className="mb-1.5 block text-[13px] font-medium text-brand-ink">
              Note <span className="font-normal text-brand-gray">(optional)</span>
            </label>
            <textarea
              id="visit-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 140))}
              rows={2}
              maxLength={140}
              placeholder="e.g. Bringing my child"
              className="w-full resize-none rounded-card border border-brand-border bg-white px-3 py-2 text-[13px] outline-none transition-colors focus:border-brand-blue"
            />
            <p className="mt-1 text-right text-[11px] text-slate-400">{note.length}/140</p>
          </div>

          {formError && <p className="text-[13px] text-brand-danger">{formError}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-brand-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn px-3.5 py-2 text-[13px] font-medium text-brand-gray transition-colors hover:bg-brand-bg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !selected || dates.length === 0}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? "Registering…" : "Confirm Registration"}
          </button>
        </div>
      </Card>
    </div>
  );
}
