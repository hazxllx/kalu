import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, CheckCircle2, Clock3, FileText, HeartPulse, Loader2, MapPin, RotateCcw, X, ZoomIn } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import { Skeleton } from "@/components/common/Skeleton";
import TablePagination from "@/components/tables/TablePagination";
import DateRangeFilter from "@/components/common/DateRangeFilter";
import { useAuth } from "@/context/AuthContext";
import { healthServicesApi, visitPlansApi } from "@/services/api";
import VisitPlanModal from "../components/VisitPlanModal";
import { availabilityLine, formatWeekdays, formatWindow, formatPlanDate, formatTime, formatDeadline } from "../lib/visitPlanFormat";

/**
 * Resident Health Services.
 *
 * A professional, institution-styled directory of the services the resident's
 * Barangay Health Center (BHC) and the covering Rural Health Unit (RHU) actually
 * offer, grouped by facility (BHC first, RHU second). Compact service cards
 * open a details dialog; registration continues through the existing visit-plan
 * workflow. All service and registration data comes from the backend.
 */
export default function ResidentHealthServices({ barangayOnly = false }) {
  const { user } = useAuth();
  const [state, setState] = useState("loading"); // loading | error | ready
  const [facilities, setFacilities] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [registerModal, setRegisterModal] = useState(null); // the service being registered
  const [detailsService, setDetailsService] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null); // { serviceId, plan }
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState("");
  const [previewPubmat, setPreviewPubmat] = useState(null);
  const [previewMemo, setPreviewMemo] = useState(null);
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const showToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 4000);
  }, []);

  const load = useCallback(() => {
    setState("loading");
    setErrorMsg("");
    const request = barangayOnly ? healthServicesApi.list() : visitPlansApi.directory();
    request
      .then((res) => {
        if (barangayOnly) {
          if (!Array.isArray(res?.rows)) throw new Error("The health-service response did not contain a catalog.");
          const services = res.rows.filter((service) => service.facilityType === "BHC");
          setFacilities(services.length ? [{
            type: "BHC",
            name: user?.barangay || "Barangay Health Center",
            services,
          }] : []);
        } else {
          setFacilities(res?.facilities || []);
        }
        setState("ready");
      })
      .catch((err) => {
        setErrorMsg(err?.message || "We couldn't load the health services. Please try again.");
        setState("error");
      });
  }, [barangayOnly, user?.barangay]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!previewPubmat && !previewMemo) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setPreviewPubmat(null);
        setPreviewMemo(null);
      }
    };
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
    if (dateFrom || dateTo) {
      const startDate = String(service.schedule?.startDate || service.startDate || "").slice(0, 10);
      const endDate = String(service.schedule?.endDate || service.endDate || startDate).slice(0, 10);
      if (!startDate || (dateFrom && endDate < dateFrom) || (dateTo && startDate > dateTo)) return false;
    }
    return true;
  }), [availabilityFilter, dateFrom, dateTo]);
  const bhcServices = useMemo(() => filterServices(bhc?.services || []), [filterServices, bhc]);
  const rhuServices = useMemo(() => filterServices(rhu?.services || []), [filterServices, rhu]);
  const hasScopeResults = (scopeFilter !== "rhu" && bhcServices.length > 0)
    || (scopeFilter !== "bhc" && rhuServices.length > 0);

  return (
    <>
      <PageHeader
        crumbs={["Dashboard", "Health Services"]}
        title="Health Services"
        subtitle={barangayOnly ? "Browse the health services offered by your Barangay Health Center." : "Explore health services offered by your Barangay Health Center and Rural Health Unit. Register for available services and keep track of your participation."}
      />

      {state === "loading" && <DirectorySkeleton />}

      {state === "error" && (
        <Card className="border border-brand-border shadow-none">
          <ErrorState message={errorMsg} onRetry={load} />
        </Card>
      )}

      {state === "ready" && (
        <div className="space-y-6 font-body">
          <section className="flex flex-col gap-4 rounded-lg border border-brand-border bg-white p-4 dark:bg-card sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-brand-ink dark:text-foreground">{barangayOnly ? "Services in your barangay" : "Find a health service"}</h2>
              <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">{barangayOnly ? "Browse programs and services offered by your Barangay Health Center." : "Filter by availability, facility, and service date."}</p>
            </div>
            {!barangayOnly && <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:w-auto lg:flex lg:items-end">
              <label className="grid min-w-0 gap-1.5 text-[13px] font-medium text-brand-gray dark:text-muted-foreground">
                Availability
                <select aria-label="Availability" value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)} className="h-10 w-full min-w-0 rounded-btn border border-brand-border bg-white px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:bg-input dark:text-foreground lg:min-w-[170px]">
                  <option value="all">All services</option>
                  <option value="open">Open for registration</option>
                  <option value="closed">Closed for registration</option>
                </select>
              </label>
              {!barangayOnly && <label className="grid min-w-0 gap-1.5 text-[13px] font-medium text-brand-gray dark:text-muted-foreground">
                Facility
                <select aria-label="Facility" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} className="h-10 w-full min-w-0 rounded-btn border border-brand-border bg-white px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:bg-input dark:text-foreground lg:min-w-[180px]">
                  <option value="all">All facilities</option>
                  <option value="bhc">Barangay Health Center</option>
                  <option value="rhu">Rural Health Unit (RHU)</option>
                </select>
              </label>}
              <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} className="w-full lg:w-52" />
              {(availabilityFilter !== "all" || (!barangayOnly && scopeFilter !== "all") || dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setAvailabilityFilter("all"); setScopeFilter("all"); setDateFrom(""); setDateTo(""); }}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-btn px-2 text-sm font-medium text-brand-blue hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 lg:self-end"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear filters
                </button>
              )}
            </div>}
          </section>

          {!hasScopeResults && (
            <div className="rounded-card border border-dashed border-brand-border bg-white px-5 py-8 text-center dark:bg-card">
              <p className="text-sm font-medium text-brand-ink dark:text-foreground">{barangayOnly && !bhcServices.length ? "No health services are currently listed for your barangay." : "No services match these filters."}</p>
              <p className="mt-1 text-xs text-brand-gray dark:text-muted-foreground">{barangayOnly ? "Check again later for new programs from your Barangay Health Center." : "Try another availability or facility scope."}</p>
            </div>
          )}

          {/* Barangay Health Center */}
          {(barangayOnly || scopeFilter !== "rhu") && <FacilitySection
            title={`Barangay Health Center${barangayName ? ` — ${barangayName}` : ""}`}
            subtitle="Health services organized by your barangay for the community."
            services={bhcServices}
            readOnly={barangayOnly}
            onViewDetails={setDetailsService}
            onPreviewPubmat={setPreviewPubmat}
            onPreviewMemo={setPreviewMemo}
          />}

          {/* Rural Health Unit */}
          {!barangayOnly && scopeFilter !== "bhc" && <FacilitySection
            title="Rural Health Unit (RHU)"
            subtitle="Health services provided by the Rural Health Unit for nearby barangays."
            services={rhuServices}
            onViewDetails={setDetailsService}
            onPreviewPubmat={setPreviewPubmat}
            onPreviewMemo={setPreviewMemo}
          />}
        </div>
      )}

      <ServiceDetailsDialog
        service={detailsService}
        readOnly={barangayOnly}
        onClose={() => setDetailsService(null)}
        onRegister={(service) => { setDetailsService(null); setRegisterModal(service); }}
        onCancel={(service) => { setDetailsService(null); setRemoveTarget({ serviceId: service.id, plan: service.plan }); }}
        onPreviewMemo={setPreviewMemo}
      />

      <VisitPlanModal
        open={!barangayOnly && Boolean(registerModal)}
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
          <div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-card bg-white shadow-2xl dark:bg-card">
            <div className="flex items-center justify-between gap-4 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-brand-ink dark:text-foreground">{previewPubmat.name}</h2>
                <p className="text-xs text-brand-gray dark:text-muted-foreground">Publication material</p>
              </div>
              <button type="button" onClick={() => setPreviewPubmat(null)} className="rounded-full p-2 text-brand-gray hover:bg-brand-bg hover:text-brand-ink dark:text-muted-foreground dark:hover:bg-hover" aria-label="Close image preview">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-3 dark:bg-background sm:p-6">
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
          <div className="flex h-[86vh] max-h-[1100px] w-[94vw] max-w-[640px] flex-col overflow-hidden rounded-card bg-white shadow-2xl dark:bg-card">
            <div className="flex items-center justify-between gap-4 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-brand-ink dark:text-foreground">{previewMemo.name}</h2>
                <p className="truncate text-xs text-brand-gray dark:text-muted-foreground">{previewMemo.filename || "Memorandum"}</p>
              </div>
              <button type="button" onClick={() => setPreviewMemo(null)} className="rounded-full p-2 text-brand-gray hover:bg-brand-bg hover:text-brand-ink dark:text-muted-foreground dark:hover:bg-hover" aria-label="Close memorandum">
                <X className="h-5 w-5" />
              </button>
            </div>
            {previewMemo.mimeType === "application/pdf" ? (
              <iframe
                title={`${previewMemo.name} memorandum`}
                src={`${previewMemo.url}#toolbar=0&navpanes=0&scrollbar=0`}
                className="min-h-0 w-full flex-1 bg-slate-100 dark:bg-background"
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
                <FileText className="h-10 w-10 text-brand-blue" aria-hidden="true" />
                <p className="text-sm font-semibold text-brand-ink dark:text-foreground">This memorandum can’t be previewed in the portal.</p>
                <p className="max-w-sm text-xs text-brand-gray dark:text-muted-foreground">Please ask the health center to provide the memorandum as a PDF for in-page viewing.</p>
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
          className="fixed bottom-4 right-4 z-[80] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg"
        >
          <CheckCircle2 className="h-4 w-4 text-brand-green" aria-hidden="true" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}

/** A white container card for one facility (BHC or RHU) with its service list. */
function FacilitySection({ title, subtitle, services, readOnly = false, onViewDetails, onPreviewPubmat }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const pageCount = Math.max(1, Math.ceil(services.length / pageSize));
  const visibleServices = services.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-base font-semibold text-brand-ink dark:text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">{subtitle}</p>
      </header>
      {services.length === 0 ? (
        <SectionEmpty />
      ) : (
        <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleServices.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc}
                readOnly={readOnly}
                onViewDetails={() => onViewDetails(svc)}
                onPreviewPubmat={onPreviewPubmat}
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
      <p className="text-sm font-medium text-brand-ink dark:text-foreground">No health services available at the moment.</p>
      <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">Please check again later for upcoming services.</p>
    </div>
  );
}

/** Compact service summary; full information and actions live in the details dialog. */
function ServiceCard({ service, readOnly = false, onViewDetails, onPreviewPubmat }) {
  const [pubmatFailed, setPubmatFailed] = useState(false);
  const schedule = formatWeekdays(service.weekdays);
  const window = formatWindow(service.windowStart, service.windowEnd);
  const eventDate = service.schedule?.startDate ? formatPlanDate(service.schedule.startDate) : "";
  const serviceType = service.visitPolicy === "by_notice" ? "By notice" : service.visitPolicy === "walk_in" ? "Walk-in" : "";
  const avail = availabilityLine(service);
  const registerBy = formatDeadline(service.schedule?.registrationDeadline);
  const isCancelled = service.cancelled === true || String(service.status || "").toLowerCase() === "cancelled";
  const stateLabel = readOnly
    ? "Available"
    : service.plan?.status || (isCancelled ? "Cancelled" : service.registrationFull ? "Fully booked" : avail.open ? "Available" : "Closed");
  const stateClass = service.plan?.status === "Attended"
    ? "bg-brand-green text-white"
    : ["Registered", "Missed"].includes(service.plan?.status)
      ? "bg-brand-blue text-white"
      : (readOnly || avail.open) && !service.registrationFull && !isCancelled
        ? "bg-brand-gold text-brand-dark"
        : "bg-white/95 text-brand-ink";
  const poster = (
    <div className="relative h-40 overflow-hidden bg-brand-dark">
      {service.pubmatUrl && !pubmatFailed ? (
        <img
          src={service.pubmatUrl}
          alt={`${service.name} publication material`}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          onError={() => setPubmatFailed(true)}
        />
      ) : <div className="absolute inset-0 bg-brand-blue" />}
      <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/95 via-brand-dark/30 to-brand-dark/10" />
      <span className={`absolute left-3 top-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${stateClass}`}>
        {stateLabel}
      </span>
      <div className="absolute inset-0 flex items-center justify-center">
        <HeartPulse className="h-10 w-10 text-white/90" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="absolute inset-x-4 bottom-3 text-left">
        {service.category && <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-gold">{service.category}</p>}
        <h3 className="mt-0.5 line-clamp-2 text-[19px] font-semibold leading-6 text-white">{service.name}</h3>
        <p className="mt-1 truncate text-xs text-white/85">{service.facilityName || "Health service"}</p>
        {(eventDate || schedule || window) && <p className="mt-0.5 truncate text-xs text-white/80">{[eventDate, schedule, window].filter(Boolean).join(" · ")}</p>}
      </div>
      {service.pubmatUrl && !pubmatFailed && (
        <span className="absolute bottom-3 right-3 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </div>
  );

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden break-words rounded-lg border border-brand-border bg-white transition-colors hover:border-brand-blue/40 [overflow-wrap:anywhere] dark:bg-card">
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

      <div className="flex min-h-[106px] flex-1 flex-col justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {serviceType && <span className="rounded-full border border-brand-border px-2.5 py-1 text-xs font-medium text-brand-gray dark:border-border dark:text-muted-foreground">{serviceType}</span>}
          {service.schedule?.registrationCapacity != null && (
            <span className={`text-xs font-medium ${service.registrationFull ? "text-brand-danger" : "text-brand-gray dark:text-muted-foreground"}`}>
              {service.registrationFull ? "Fully booked" : `${service.registrationRemaining} place${service.registrationRemaining === 1 ? "" : "s"} left`}
            </span>
          )}
        </div>
        {registerBy && <p className="truncate text-xs text-brand-gray dark:text-muted-foreground" title={`Registration deadline: ${registerBy}`}>Register by {registerBy}</p>}
      </div>
      <footer className="mt-auto border-t border-brand-border px-4 py-3">
        <button type="button" onClick={onViewDetails} className="inline-flex min-h-9 w-full items-center justify-center rounded-btn border border-brand-border px-3 text-sm font-semibold text-brand-blue transition-colors hover:border-brand-blue/40 hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40">
          View details
        </button>
      </footer>
    </article>
  );
}

function ServiceDetailsDialog({ service, readOnly = false, onClose, onRegister, onCancel, onPreviewMemo }) {
  if (!service) return null;
  const availability = availabilityLine(service);
  const isCancelled = service.cancelled === true || String(service.status || "").toLowerCase() === "cancelled";
  const registrationOpen = availability.open && !service.registrationFull && !isCancelled;
  const plan = service.plan || null;
  const activePlan = plan?.status === "Registered";
  const schedule = service.schedule || {};
  const startDate = formatFullDate(schedule.startDate);
  const endDate = schedule.endDate && schedule.endDate !== schedule.startDate ? formatFullDate(schedule.endDate) : "";
  const scheduledDate = startDate ? `${startDate}${endDate ? ` – ${endDate}` : ""}` : "To be announced";
  const times = schedule.startTime || schedule.endTime
    ? [schedule.startTime ? formatTime(schedule.startTime) : "", schedule.endTime ? formatTime(schedule.endTime) : ""].filter(Boolean).join(" – ")
    : formatWindow(service.windowStart, service.windowEnd) || "To be announced";
  const registrationType = service.visitPolicy === "walk_in" ? "Walk-in" : service.visitPolicy === "by_notice" ? "Registration required (by notice)" : "Registration required";
  const deadlineText = formatDeadline(schedule.registrationDeadline);
  const deadlineDate = formatFullDate(String(schedule.registrationDeadline || "").slice(0, 10));
  const deadlineTime = String(schedule.registrationDeadline || "").slice(11, 16);
  const deadline = deadlineDate
    ? `${deadlineDate}${deadlineTime && deadlineTime !== "00:00" ? `, ${formatTime(deadlineTime)}` : ""}`
    : deadlineText;
  const statusLabel = readOnly
    ? "Available"
    : isCancelled ? "Cancelled" : plan?.status || (service.registrationFull ? "Fully booked" : availability.open ? "Open for registration" : "Registration closed");

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[85] flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-brand-border bg-white shadow-2xl focus:outline-none dark:bg-card">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border px-5 py-4 sm:px-6">
            <div className="min-w-0">
              {service.category && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-blue">{service.category}</p>}
              <Dialog.Title className="mt-1 break-words text-xl font-semibold leading-tight text-brand-ink dark:text-foreground">{service.name}</Dialog.Title>
              <Dialog.Description className="sr-only">Service information and registration options</Dialog.Description>
              <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                statusLabel === "Attended" ? "bg-emerald-50 text-emerald-700" : ["Registered", "Missed"].includes(statusLabel) ? "bg-brand-blue/10 text-brand-blue" : service.registrationFull && !plan ? "bg-amber-50 text-amber-800" : availability.open && !isCancelled && !plan ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}>
                {statusLabel}
              </span>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="shrink-0 rounded-full p-2 text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" aria-label="Close service details">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {service.description && <p className="whitespace-pre-line text-sm leading-relaxed text-brand-gray dark:text-muted-foreground">{service.description}</p>}
            <dl className="grid gap-4 rounded-lg bg-brand-bg/70 p-4 text-sm dark:bg-background sm:grid-cols-2">
              <DetailItem icon={MapPin} label="Barangay or facility" value={service.facilityName || "Health facility"} />
              <DetailItem icon={CalendarDays} label="Scheduled date" value={scheduledDate} />
              <DetailItem icon={Clock3} label="Time" value={times} />
              <DetailItem icon={CalendarDays} label="Registration deadline" value={deadline || "Not specified"} />
              <DetailItem icon={HeartPulse} label="Registration type" value={registrationType} />
              {service.weekdays?.length > 0 && <DetailItem icon={CalendarDays} label="Recurring days" value={formatWeekdays(service.weekdays)} />}
            </dl>
            {deadline && <p className="text-xs text-brand-gray dark:text-muted-foreground">Please register by {deadline}.</p>}
            {service.memo?.url && (
              <button
                type="button"
                onClick={() => onPreviewMemo?.({ ...service.memo, name: service.name })}
                className="inline-flex max-w-full items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2 text-xs font-semibold text-brand-blue transition-colors hover:border-brand-blue/40 hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:bg-card"
                title={service.memo.filename || "View memorandum"}
              >
                <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">View memorandum{service.memo.filename ? ` · ${service.memo.filename}` : ""}</span>
              </button>
            )}
            {service.registrationFull && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">This service has reached its resident registration limit.</p>}
            {!readOnly && !availability.open && !isCancelled && !service.registrationFull && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-brand-gray">{availability.text}</p>}
            {isCancelled && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-brand-gray">This service has been cancelled.</p>}
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-brand-border bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:bg-card">
            <button type="button" onClick={onClose} className="h-10 rounded-btn border border-brand-border px-4 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:text-muted-foreground">
              Close
            </button>
            {readOnly ? (
              <p className="self-center text-xs text-brand-gray dark:text-muted-foreground">Registration and resident-specific actions are available after verification.</p>
            ) : <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {activePlan && <button type="button" onClick={() => onCancel(service)} className="h-10 rounded-btn px-3 text-sm font-medium text-brand-blue hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40">Cancel registration</button>}
              {registrationOpen && !plan ? (
                <button type="button" onClick={() => onRegister(service)} className="h-10 rounded-btn bg-brand-blue px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2">Register</button>
              ) : !plan && (
                <button type="button" disabled className="h-10 cursor-not-allowed rounded-btn border border-brand-border bg-brand-bg px-4 text-sm font-medium text-slate-400">
                  {isCancelled ? "Service Cancelled" : service.registrationFull ? "Fully Booked" : "Registration Closed"}
                </button>
              )}
            </div>}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatFullDate(value) {
  const date = formatPlanDate(value);
  return date ? `${date} ${String(value).slice(0, 4)}` : "";
}

function DetailItem({ icon: Icon, label, value }) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-brand-gray dark:text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-medium text-brand-ink dark:text-foreground">{value}</dd>
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
      <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-[380px] overflow-y-auto p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-brand-ink dark:text-foreground">Cancel this registration?</h2>
        <p className="mt-1.5 text-sm text-brand-gray dark:text-muted-foreground">
          The health center will be notified.
          {plan?.plannedDate ? ` Your registration for ${formatPlanDate(plan.plannedDate)} will be released.` : ""}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-btn px-3.5 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg disabled:opacity-60 dark:text-muted-foreground dark:hover:bg-hover"
          >
            Keep registration
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {busy ? "Cancelling…" : "Cancel registration"}
          </button>
        </div>
      </Card>
    </div>
  );
}

/** Loading placeholder matching the compact service-card directory grid. */
function DirectorySkeleton() {
  return (
    <div role="status" aria-label="Loading health services" className="space-y-5">
      {[0, 1].map((s) => (
        <section key={s} className="space-y-3">
          <div>
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="mt-2 h-3 w-80 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: s === 0 ? 3 : 2 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-brand-border bg-white">
                <Skeleton className="h-40 w-full rounded-none" />
                <div className="space-y-3 p-4"><Skeleton className="h-4 w-24 rounded-full" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-9 w-full" /></div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
