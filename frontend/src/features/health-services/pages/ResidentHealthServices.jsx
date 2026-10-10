import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, MapPin, Stethoscope, CheckCircle2, Loader2 } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import { Skeleton } from "@/components/common/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { visitPlansApi } from "@/services/api";
import VisitPlanModal from "../components/VisitPlanModal";
import { availabilityLine, formatWeekdays, formatWindow, formatPlanDate, formatServiceSchedule, formatDeadline } from "../lib/visitPlanFormat";

/**
 * Resident Health Services.
 *
 * A professional, institution-styled directory of the services the resident's
 * Barangay Health Center (BHC) and the covering Rural Health Unit (RHU) actually
 * offer, in two clearly separated white container cards (BHC first, RHU second).
 * Each service renders as a horizontal card; the primary action is a real
 * Register button that creates a registration against the authenticated resident
 * and the selected service (reusing the existing visit-plan registration
 * endpoint). All service and registration data comes from the backend — nothing
 * is hardcoded or fabricated.
 */
export default function ResidentHealthServices() {
  const { user } = useAuth();
  const [state, setState] = useState("loading"); // loading | error | ready
  const [facilities, setFacilities] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [registerModal, setRegisterModal] = useState(null); // the service being registered
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
      if (registerModal && plan)
        patchServicePlan(registerModal.id, {
          id: plan.id,
          plannedDate: plan.plannedDate,
          note: plan.note || "",
          // A freshly created registration has no attendance yet, so the
          // resident-facing status is always "Registered".
          status: "Registered",
          attendanceStatus: null,
        });
    },
    [registerModal, patchServicePlan],
  );

  const confirmRemove = useCallback(async () => {
    if (!removeTarget?.plan?.id) return;
    setRemoving(true);
    try {
      await visitPlansApi.remove(removeTarget.plan.id);
      patchServicePlan(removeTarget.serviceId, null);
      showToast("Your registration has been cancelled.");
      setRemoveTarget(null);
    } catch (err) {
      showToast(err?.message || "Could not cancel your registration. Please try again.");
    } finally {
      setRemoving(false);
    }
  }, [removeTarget, patchServicePlan, showToast]);

  const bhc = useMemo(() => facilities.find((f) => f.type === "BHC") || null, [facilities]);
  const rhu = useMemo(() => facilities.find((f) => f.type === "RHU") || null, [facilities]);
  const barangayName = bhc?.name || user?.barangay || "";

  return (
    <>
      <PageHeader
        crumbs={["Dashboard", "Health Services"]}
        title="Health Services"
        subtitle="Explore health services offered by your Barangay Health Center and Rural Health Unit. Register for available services and keep track of your participation."
      />

      {state === "loading" && <DirectorySkeleton />}

      {state === "error" && (
        <Card className="border border-brand-border shadow-none">
          <ErrorState message={errorMsg} onRetry={load} />
        </Card>
      )}

      {state === "ready" && (
        <div className="space-y-5">
          {/* Barangay Health Center */}
          <FacilitySection
            title={`Barangay Health Center${barangayName ? ` — ${barangayName}` : ""}`}
            subtitle="Health services organized by your barangay for the community."
            services={bhc?.services || []}
            onRegister={(svc) => setRegisterModal(svc)}
            onCancel={(svc) => setRemoveTarget({ serviceId: svc.id, plan: svc.plan })}
          />

          {/* Rural Health Unit */}
          <FacilitySection
            title="Rural Health Unit (RHU)"
            subtitle="Health services provided by the Rural Health Unit for nearby barangays."
            services={rhu?.services || []}
            onRegister={(svc) => setRegisterModal(svc)}
            onCancel={(svc) => setRemoveTarget({ serviceId: svc.id, plan: svc.plan })}
          />
        </div>
      )}

      <VisitPlanModal
        open={Boolean(registerModal)}
        service={registerModal}
        onClose={() => setRegisterModal(null)}
        onConfirmed={onConfirmed}
        showToast={showToast}
      />

      {removeTarget && (
        <CancelRegistrationDialog
          plan={removeTarget.plan}
          busy={removing}
          onCancel={() => (removing ? null : setRemoveTarget(null))}
          onConfirm={confirmRemove}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg"
        >
          <CheckCircle2 className="h-4 w-4 text-brand-green" aria-hidden="true" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}

/** A white container card for one facility (BHC or RHU) with its service list. */
function FacilitySection({ title, subtitle, services, onRegister, onCancel }) {
  return (
    <section className="overflow-hidden rounded-card border border-brand-border bg-white shadow-card">
      <header className="border-b border-brand-border px-5 py-4 md:px-6">
        <h2 className="text-base font-semibold text-brand-ink">{title}</h2>
        <p className="mt-0.5 text-[13px] text-brand-gray">{subtitle}</p>
      </header>
      <div className="p-4 md:p-5">
        {services.length === 0 ? (
          <SectionEmpty />
        ) : (
          <div className="space-y-3">
            {services.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc}
                onRegister={() => onRegister(svc)}
                onCancel={() => onCancel(svc)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Restrained empty state shown inside a facility card when it has no services. */
function SectionEmpty() {
  return (
    <div className="rounded-card border border-dashed border-brand-border bg-brand-bg px-5 py-8 text-center">
      <p className="text-[13px] font-medium text-brand-ink">No health services available at the moment.</p>
      <p className="mt-1 text-[13px] text-brand-gray">Please check again later for upcoming services.</p>
    </div>
  );
}

const STATUS_STYLES = {
  Registered: "bg-brand-blue/10 text-brand-blue",
  Attended: "bg-brand-green/10 text-brand-green",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Cancelled: "bg-slate-100 text-slate-500",
};

/** A small status pill for a registration. */
function StatusBadge({ status }) {
  const label = status || "Registered";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[label] || STATUS_STYLES.Registered}`}>
      {label}
    </span>
  );
}

/**
 * One health service, laid out horizontally on desktop and stacked on mobile:
 *   [icon]  name + type + description      date/time/location      [action]
 * The action is a real Register button whose state reflects actual backend
 * availability and the resident's current registration.
 */
function ServiceCard({ service, onRegister, onCancel }) {
  const schedule = formatWeekdays(service.weekdays);
  const window = formatWindow(service.windowStart, service.windowEnd);
  const serviceType = service.visitPolicy === "by_notice" ? "By notice" : "Walk-in";
  const avail = availabilityLine(service);
  const plan = service.plan || null;
  const status = plan?.status || null;
  const isActive = status === "Registered"; // registered, not yet attended/missed

  // The concrete one-off service window (set on the service record), shown so a
  // resident sees the actual date and time before registering.
  const serviceSchedule = formatServiceSchedule(service.schedule);
  const registerBy = formatDeadline(service.schedule?.registrationDeadline);

  return (
    <div className="rounded-card border border-brand-border bg-white px-4 py-4 transition-colors hover:border-brand-blue/40 md:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        {/* Icon */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-brand-blue/10 text-brand-blue">
          <Stethoscope className="h-5 w-5" aria-hidden="true" />
        </div>

        {/* Name + type + description */}
        <div className="min-w-0 lg:flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[15px] font-semibold leading-tight text-brand-ink">{service.name}</h3>
            <span className="inline-flex items-center rounded border border-brand-border px-1.5 py-0.5 text-[11px] font-medium text-brand-gray">
              {serviceType}
            </span>
          </div>
          {service.description && (
            <p className="mt-1 text-[13px] leading-relaxed text-brand-gray">{service.description}</p>
          )}
        </div>

        {/* Schedule / time / location */}
        <div className="space-y-1.5 text-[12px] text-brand-gray lg:w-52 lg:shrink-0">
          {serviceSchedule && (
            <p className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
              <span className="font-medium text-brand-ink">{serviceSchedule}</span>
            </p>
          )}
          {registerBy && (
            <p className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
              <span>Register by {registerBy}</span>
            </p>
          )}
          {schedule && (
            <p className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
              <span>{schedule}</span>
            </p>
          )}
          {window && (
            <p className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
              <span>{window}</span>
            </p>
          )}
          {service.facilityName && (
            <p className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
              <span className="truncate">{service.facilityName}</span>
            </p>
          )}
          {!serviceSchedule && !schedule && !window && (
            <p className="italic text-slate-400">Schedule to be announced.</p>
          )}
        </div>

        {/* Action */}
        <div className="shrink-0 lg:w-44 lg:text-right">
          {plan ? (
            <div className="flex flex-col items-start gap-1.5 lg:items-end">
              <StatusBadge status={status} />
              {isActive && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-[12px] font-medium text-brand-blue underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  Cancel registration
                </button>
              )}
            </div>
          ) : avail.open ? (
            <button
              type="button"
              onClick={onRegister}
              className="w-full rounded-btn bg-brand-blue px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 lg:w-auto"
            >
              Register
            </button>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="w-full cursor-not-allowed rounded-btn border border-brand-border bg-brand-bg px-4 py-2 text-[13px] font-medium text-slate-400 lg:w-auto"
            >
              Registration Closed
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Confirm dialog for cancelling an active registration. */
function CancelRegistrationDialog({ plan, busy, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cancel registration"
    >
      <Card className="w-full max-w-[380px] p-5">
        <h2 className="text-[15px] font-semibold text-brand-ink">Cancel this registration?</h2>
        <p className="mt-1.5 text-[13px] text-brand-gray">
          The health center will be notified.
          {plan?.plannedDate ? ` Your registration for ${formatPlanDate(plan.plannedDate)} will be released.` : ""}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-btn px-3.5 py-2 text-[13px] font-medium text-brand-gray transition-colors hover:bg-brand-bg disabled:opacity-60"
          >
            Keep registration
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-danger px-4 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {busy ? "Cancelling…" : "Cancel registration"}
          </button>
        </div>
      </Card>
    </div>
  );
}

/** Loading placeholder: two facility container cards with card rows. */
function DirectorySkeleton() {
  return (
    <div role="status" aria-label="Loading health services" className="space-y-5">
      {[0, 1].map((s) => (
        <section key={s} className="overflow-hidden rounded-card border border-brand-border bg-white shadow-card">
          <div className="border-b border-brand-border px-5 py-4">
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="mt-2 h-3 w-80 max-w-full" />
          </div>
          <div className="space-y-3 p-4 md:p-5">
            {Array.from({ length: s === 0 ? 2 : 1 }).map((_, i) => (
              <div key={i} className="rounded-card border border-brand-border bg-white px-4 py-4 md:px-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <Skeleton className="h-11 w-11 shrink-0 rounded-card" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                  <Skeleton className="h-9 w-full lg:w-32" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
