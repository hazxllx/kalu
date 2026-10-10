import React, { useCallback, useEffect, useState } from "react";
import { CalendarDays, Clock, Stethoscope } from "lucide-react";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { Skeleton } from "@/components/common/Skeleton";
import { visitPlansApi } from "@/services/api";
import VisitPlanModal from "../components/VisitPlanModal";
import { availabilityLine, formatWeekdays, formatWindow, formatPlanDate } from "../lib/visitPlanFormat";

const FACILITY_HEADING = {
  BHC: (name) => `Barangay Health Center — ${name}`,
  RHU: (name) => `Rural Health Unit — ${name}`,
};

/**
 * Resident Health Services directory.
 *
 * A calm, informational directory of the services the resident's barangay
 * health center (BHC) and the covering Rural Health Unit (RHU) actually offer,
 * grouped by facility. The only action is a per-service "I plan to visit"
 * intent — the resident commits to a day and the barangay health worker is
 * notified. There is no appointment status, approval queue or plan dashboard:
 * a service either shows the action, or (when the resident already has a plan)
 * a single inline line with a Remove link.
 */
export default function ResidentHealthServices() {
  const [state, setState] = useState("loading"); // loading | error | ready
  const [facilities, setFacilities] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [planModal, setPlanModal] = useState(null); // the service being planned
  const [removeTarget, setRemoveTarget] = useState(null); // { serviceId, plan }
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 4000);
  }, []);

  const load = useCallback(() => {
    setState("loading");
    setErrorMsg("");
    visitPlansApi
      .directory()
      .then((res) => {
        setFacilities(res?.facilities || []);
        setState("ready");
      })
      .catch((err) => {
        setErrorMsg(err?.message || "We couldn't load the health services. Please try again.");
        setState("error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Replace the plan on one service across the grouped structure.
  const patchServicePlan = useCallback((serviceId, plan) => {
    setFacilities((prev) =>
      prev.map((facility) => ({
        ...facility,
        services: facility.services.map((svc) => (svc.id === serviceId ? { ...svc, plan } : svc)),
      })),
    );
  }, []);

  const onConfirmed = useCallback(
    (plan) => {
      if (planModal && plan) patchServicePlan(planModal.id, { id: plan.id, plannedDate: plan.plannedDate, note: plan.note || "" });
    },
    [planModal, patchServicePlan],
  );

  const confirmRemove = useCallback(async () => {
    if (!removeTarget?.plan?.id) return;
    setRemoving(true);
    try {
      await visitPlansApi.remove(removeTarget.plan.id);
      patchServicePlan(removeTarget.serviceId, null);
      showToast("Visit plan removed. Your barangay health center has been notified.");
      setRemoveTarget(null);
    } catch (err) {
      showToast(err?.message || "Could not remove the visit plan. Please try again.");
    } finally {
      setRemoving(false);
    }
  }, [removeTarget, patchServicePlan, showToast]);

  return (
    <>
      {/* Header block */}
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Health Services</p>
        <h1 className="mt-1 text-[22px] font-semibold leading-tight text-brand-ink">Health Services</h1>
        <p className="mt-1 text-[13px] text-brand-gray">
          Services offered at your barangay health center and the RHU.
        </p>
      </header>

      {state === "loading" && <DirectorySkeleton />}

      {state === "error" && (
        <Card className="border border-brand-border shadow-none">
          <ErrorState message={errorMsg} onRetry={load} />
        </Card>
      )}

      {state === "ready" && facilities.length === 0 && (
        <Card className="border border-brand-border shadow-none">
          <EmptyState
            icon={Stethoscope}
            title="No services available"
            description="No services available. Contact your barangay health center."
          />
        </Card>
      )}

      {state === "ready" &&
        facilities.length > 0 &&
        facilities.map((facility, i) => (
          <section key={facility.type} className={i === 0 ? "" : "mt-4"}>
            <h2 className="mb-2 border-b border-brand-border pb-2 text-[13px] font-semibold text-brand-ink">
              {(FACILITY_HEADING[facility.type] || ((n) => n))(facility.name)}
            </h2>

            {facility.services.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-brand-gray">No services offered at this facility yet.</p>
            ) : (
              <div className="space-y-3">
                {facility.services.map((svc) => (
                  <ServiceCard
                    key={svc.id}
                    service={svc}
                    onPlan={() => setPlanModal(svc)}
                    onRemove={() => setRemoveTarget({ serviceId: svc.id, plan: svc.plan })}
                  />
                ))}
              </div>
            )}
          </section>
        ))}

      <VisitPlanModal
        open={Boolean(planModal)}
        service={planModal}
        onClose={() => setPlanModal(null)}
        onConfirmed={onConfirmed}
        showToast={showToast}
      />

      {removeTarget && (
        <RemovePlanDialog
          plan={removeTarget.plan}
          busy={removing}
          onCancel={() => (removing ? null : setRemoveTarget(null))}
          onConfirm={confirmRemove}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-card border border-brand-border bg-white px-4 py-2.5 text-[13px] text-brand-ink shadow-sm"
        >
          {toast}
        </div>
      )}
    </>
  );
}

/** One service row: info-dense, two columns on desktop, stacked on mobile. */
function ServiceCard({ service, onPlan, onRemove }) {
  const schedule = formatWeekdays(service.weekdays);
  const window = formatWindow(service.windowStart, service.windowEnd);
  const policyTag = service.visitPolicy === "by_notice" ? "By notice" : "Walk-in";
  const avail = availabilityLine(service);
  const hasPlan = Boolean(service.plan);

  return (
    <div className="rounded-card border border-brand-border bg-white px-5 py-4 transition-colors hover:bg-brand-bg">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        {/* Left: name, description, meta */}
        <div className="min-w-0 lg:flex-1">
          <h3 className="text-[15px] font-semibold leading-tight text-brand-ink">{service.name}</h3>
          {service.description && (
            <p className="mt-0.5 truncate text-[13px] text-brand-gray">{service.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-brand-gray">
            {schedule && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {schedule}
                {window ? ` · ${window}` : ""}
              </span>
            )}
            <span className="inline-flex items-center rounded border border-brand-border bg-white px-1.5 py-0.5 text-[11px] font-medium text-brand-gray">
              {policyTag}
            </span>
          </div>
        </div>

        {/* Right: availability line + action (or inline plan line) */}
        <div className="shrink-0 lg:w-56 lg:text-right">
          <p className={`mb-2 text-[12px] ${avail.open ? "text-brand-gray" : "text-slate-400"}`}>{avail.text}</p>

          {hasPlan ? (
            <div className="text-[13px] lg:text-right">
              <span className="text-brand-ink">You plan to visit on {formatPlanDate(service.plan.plannedDate)}.</span>{" "}
              <button
                type="button"
                onClick={onRemove}
                className="font-medium text-brand-blue underline-offset-2 hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onPlan}
              disabled={!avail.open}
              className="w-full rounded-btn border border-brand-blue bg-white px-3.5 py-2 text-[13px] font-medium text-brand-blue transition-colors hover:bg-brand-blue/5 disabled:cursor-not-allowed disabled:border-brand-border disabled:text-slate-400 disabled:hover:bg-white lg:w-auto"
            >
              I plan to visit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small confirm dialog for removing a visit plan. */
function RemovePlanDialog({ plan, busy, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Remove visit plan"
    >
      <Card className="w-full max-w-[380px] p-5">
        <h2 className="text-[15px] font-semibold text-brand-ink">Remove this visit plan?</h2>
        <p className="mt-1.5 text-[13px] text-brand-gray">
          The health center will be notified.
          {plan?.plannedDate ? ` Your plan for ${formatPlanDate(plan.plannedDate)} will be removed.` : ""}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-btn px-3.5 py-2 text-[13px] font-medium text-brand-gray transition-colors hover:bg-brand-bg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-btn bg-brand-danger px-4 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Removing…" : "Remove plan"}
          </button>
        </div>
      </Card>
    </div>
  );
}

/** Loading placeholder: two facility sections, 2–3 card placeholders each. */
function DirectorySkeleton() {
  return (
    <div role="status" aria-label="Loading health services">
      {[0, 1].map((s) => (
        <section key={s} className={s === 0 ? "" : "mt-4"}>
          <div className="mb-2 border-b border-brand-border pb-2">
            <Skeleton className="h-3.5 w-56 max-w-full" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: s === 0 ? 3 : 2 }).map((_, i) => (
              <div key={i} className="rounded-card border border-brand-border bg-white px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-9 w-full lg:w-28" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
