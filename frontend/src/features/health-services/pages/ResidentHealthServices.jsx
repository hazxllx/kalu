import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, MapPin, Stethoscope, CheckCircle2, Loader2, X, ZoomIn, FileText } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import { Skeleton } from "@/components/common/Skeleton";
import TablePagination from "@/components/tables/TablePagination";
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
  const [previewPubmat, setPreviewPubmat] = useState(null);
  const [previewMemo, setPreviewMemo] = useState(null);
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");

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

  useEffect(() => {
    if (!previewPubmat && !previewMemo) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setPreviewPubmat(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewPubmat, previewMemo]);

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
  const filterServices = useCallback((services = []) => services.filter((service) => {
    if (availabilityFilter === "open" && !availabilityLine(service).open) return false;
    if (availabilityFilter === "closed" && availabilityLine(service).open) return false;
    return true;
  }), [availabilityFilter]);
  const bhcServices = useMemo(() => filterServices(bhc?.services || []), [filterServices, bhc]);
  const rhuServices = useMemo(() => filterServices(rhu?.services || []), [filterServices, rhu]);
  const hasScopeResults = (scopeFilter !== "rhu" && bhcServices.length > 0)
    || (scopeFilter !== "bhc" && rhuServices.length > 0);

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
          <section className="flex flex-col gap-3 rounded-lg border border-brand-border bg-white px-5 py-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-display text-base text-brand-ink">Find a health service</h2>
              <p className="mt-0.5 text-xs text-brand-gray">Filter by availability and the facility offering the service.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="grid gap-1.5 text-xs font-medium text-brand-gray">
                Availability
                <select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)} className="min-h-10 min-w-[160px] rounded-full border border-brand-border bg-white px-3.5 text-xs text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40">
                  <option value="all">All services</option>
                  <option value="open">Open for registration</option>
                  <option value="closed">Closed for registration</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-brand-gray">
                Facility
                <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} className="min-h-10 min-w-[180px] rounded-full border border-brand-border bg-white px-3.5 text-xs text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40">
                  <option value="all">All facilities</option>
                  <option value="bhc">Barangay Health Center</option>
                  <option value="rhu">Rural Health Unit (RHU)</option>
                </select>
              </label>
            </div>
          </section>

          {!hasScopeResults && (
            <div className="rounded-card border border-dashed border-brand-border bg-white px-5 py-8 text-center">
              <p className="text-sm font-medium text-brand-ink">No services match these filters.</p>
              <p className="mt-1 text-xs text-brand-gray">Try another availability or facility scope.</p>
            </div>
          )}

          {/* Barangay Health Center */}
          {scopeFilter !== "rhu" && <FacilitySection
            title={`Barangay Health Center${barangayName ? ` — ${barangayName}` : ""}`}
            subtitle="Health services organized by your barangay for the community."
            services={bhcServices}
            onRegister={(svc) => setRegisterModal(svc)}
            onCancel={(svc) => setRemoveTarget({ serviceId: svc.id, plan: svc.plan })}
            onPreviewPubmat={setPreviewPubmat}
            onPreviewMemo={setPreviewMemo}
          />}

          {/* Rural Health Unit */}
          {scopeFilter !== "bhc" && <FacilitySection
            title="Rural Health Unit (RHU)"
            subtitle="Health services provided by the Rural Health Unit for nearby barangays."
            services={rhuServices}
            onRegister={(svc) => setRegisterModal(svc)}
            onCancel={(svc) => setRemoveTarget({ serviceId: svc.id, plan: svc.plan })}
            onPreviewPubmat={setPreviewPubmat}
            onPreviewMemo={setPreviewMemo}
          />}
        </div>
      )}

      <VisitPlanModal
        open={Boolean(registerModal)}
        service={registerModal}
        onClose={() => setRegisterModal(null)}
        onConfirmed={onConfirmed}
        showToast={showToast}
      />

      {previewPubmat && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`${previewPubmat.name} publication material`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewPubmat(null); }}
        >
          <div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-card bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-brand-ink">{previewPubmat.name}</h2>
                <p className="text-xs text-brand-gray">Publication material</p>
              </div>
              <button type="button" onClick={() => setPreviewPubmat(null)} className="rounded-full p-2 text-brand-gray hover:bg-brand-bg hover:text-brand-ink" aria-label="Close image preview">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-3 sm:p-6">
              <img src={previewPubmat.url} alt={`${previewPubmat.name} publication material enlarged`} className="max-h-[75vh] max-w-full rounded object-contain" />
            </div>
          </div>
        </div>
      )}

      {previewMemo && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${previewMemo.name} memorandum`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewMemo(null); }}
        >
          <div className="flex h-[86vh] max-h-[1100px] w-[94vw] max-w-[640px] flex-col overflow-hidden rounded-card bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-brand-ink">{previewMemo.name}</h2>
                <p className="truncate text-xs text-brand-gray">{previewMemo.filename || "Memorandum"}</p>
              </div>
              <button type="button" onClick={() => setPreviewMemo(null)} className="rounded-full p-2 text-brand-gray hover:bg-brand-bg hover:text-brand-ink" aria-label="Close memorandum">
                <X className="h-5 w-5" />
              </button>
            </div>
            {previewMemo.mimeType === "application/pdf" ? (
              <iframe
                title={`${previewMemo.name} memorandum`}
                src={`${previewMemo.url}#toolbar=0&navpanes=0&scrollbar=0`}
                className="min-h-0 w-full flex-1 bg-slate-100"
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
                <FileText className="h-10 w-10 text-brand-blue" aria-hidden="true" />
                <p className="text-sm font-semibold text-brand-ink">This memorandum can’t be previewed in the portal.</p>
                <p className="max-w-sm text-xs text-brand-gray">Please ask the health center to provide the memorandum as a PDF for in-page viewing.</p>
              </div>
            )}
          </div>
        </div>
      )}

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
function FacilitySection({ title, subtitle, services, onRegister, onCancel, onPreviewPubmat, onPreviewMemo }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const pageCount = Math.max(1, Math.ceil(services.length / pageSize));
  const visibleServices = services.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

  return (
    <section className="flex flex-col gap-3">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-brand-gray">{title}</p>
        <p className="mt-1 text-[12px] text-brand-gray">{subtitle}</p>
      </header>
      {services.length === 0 ? (
        <SectionEmpty />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleServices.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc}
                onRegister={() => onRegister(svc)}
                onCancel={() => onCancel(svc)}
                onPreviewPubmat={onPreviewPubmat}
                onPreviewMemo={onPreviewMemo}
              />
            ))}
        </div>
      )}
      {services.length > 0 && (
        <TablePagination
          total={services.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          itemLabel="services"
          className="mt-1"
        />
      )}
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
function ServiceCard({ service, onRegister, onCancel, onPreviewPubmat, onPreviewMemo }) {
  const [pubmatFailed, setPubmatFailed] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
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
  const stateLabel = status || (avail.open ? "Available" : "Closed");
  const stateClass = status === "Attended"
    ? "bg-brand-green text-white"
    : isActive
      ? "bg-brand-blue text-white"
      : avail.open
        ? "bg-brand-gold text-brand-dark"
        : "bg-brand-bg text-brand-ink";
  const poster = (
    <div className="relative aspect-[4/5] overflow-hidden bg-brand-dark">
      {service.pubmatUrl && !pubmatFailed ? (
        <img
          src={service.pubmatUrl}
          alt={`${service.name} publication material`}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          onError={() => setPubmatFailed(true)}
        />
      ) : (
        <div className="grid h-full place-items-center bg-gradient-to-br from-brand-blue to-brand-dark">
          <Stethoscope className="h-12 w-12 text-white/55" aria-hidden="true" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-brand-dark via-brand-dark/50 to-transparent" />
      <span className={`absolute left-3 top-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${stateClass}`}>
        {stateLabel}
      </span>
      <div className="absolute inset-x-4 bottom-4 text-left">
        {service.category && <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-brand-gold">{service.category}</p>}
        <h3 className="mt-1 font-display text-lg leading-snug text-white">{service.name}</h3>
        <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-white/70">{service.facilityName || "Health service"}</p>
        {serviceSchedule && <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/55">{serviceSchedule}</p>}
      </div>
      {service.pubmatUrl && !pubmatFailed && (
        <span className="absolute bottom-3 right-3 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </div>
  );

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-brand-border bg-white transition-colors hover:border-brand-blue/40">
      {service.pubmatUrl && !pubmatFailed ? (
        <button
          type="button"
          onClick={() => onPreviewPubmat?.({ url: service.pubmatUrl, name: service.name })}
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue"
          aria-label={`Enlarge ${service.name} publication material`}
          title="Click to enlarge publication material"
        >
          {poster}
        </button>
      ) : poster}

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-brand-border px-2 py-0.5 text-[10px] font-medium text-brand-gray">{serviceType}</span>
          {registerBy && <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-brand-gray">Register by {registerBy}</span>}
        </div>
        {service.description && (
          <div className="mt-2">
            <p className={`text-xs leading-relaxed text-brand-gray ${descriptionExpanded ? "" : "line-clamp-3"}`}>{service.description}</p>
            {service.description.length > 180 && (
              <button type="button" aria-expanded={descriptionExpanded} onClick={() => setDescriptionExpanded((expanded) => !expanded)} className="mt-1 inline-flex min-h-7 items-center text-[11px] font-semibold text-brand-blue underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
                {descriptionExpanded ? "View less" : "View more"}
              </button>
            )}
          </div>
        )}
        {service.memo?.url && (
          <button
            type="button"
            onClick={() => onPreviewMemo?.({ ...service.memo, name: service.name })}
            className="mt-2 inline-flex max-w-full items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2 text-xs font-semibold text-brand-blue transition-colors hover:border-brand-blue/40 hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
            title={service.memo.filename || "View memorandum"}
          >
            <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">View memorandum{service.memo.filename ? ` · ${service.memo.filename}` : ""}</span>
          </button>
        )}
        <div className="mt-3 space-y-1.5 text-[11px] text-brand-gray">
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
      </div>
      <footer className="mt-auto border-t border-brand-border px-4 py-3">
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
            <div className="flex flex-col items-start gap-1 lg:items-end">
              <button
                type="button"
                disabled
                aria-disabled="true"
                title={avail.text}
                className="w-full cursor-not-allowed rounded-btn border border-brand-border bg-brand-bg px-4 py-2 text-[13px] font-medium text-slate-400 lg:w-auto"
              >
                Registration Closed
              </button>
              {avail.text && (
                <span className="text-[11px] leading-tight text-slate-400 lg:text-right">{avail.text}</span>
              )}
            </div>
          )}
      </footer>
    </article>
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
      <Card className="w-full max-w-[380px] p-4 sm:p-5">
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

/** Loading placeholder matching the poster-card directory grid. */
function DirectorySkeleton() {
  return (
    <div role="status" aria-label="Loading health services" className="space-y-5">
      {[0, 1].map((s) => (
        <section key={s} className="space-y-3">
          <div>
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="mt-2 h-3 w-80 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: s === 0 ? 3 : 2 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-brand-border bg-white">
                <Skeleton className="aspect-[4/5] w-full rounded-none" />
                <div className="space-y-2 p-4">
                  <div className="flex gap-2">
                    <Skeleton className="h-4 w-16 rounded-full" />
                    <Skeleton className="h-4 w-24 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
