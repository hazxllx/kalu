// frontend/src/features/dashboards/pages/ResidentDashboard.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileText, HeartPulse, X } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import TransferStatusBanner from "@/features/verification/components/TransferStatusBanner";
import ResidentHealthSnapshot from "@/features/dashboards/components/ResidentHealthSnapshot";
import { CancelRegistrationDialog, ServiceCard, ServiceDetailsDialog } from "@/features/health-services/pages/ResidentHealthServices";
import VisitPlanModal from "@/features/health-services/components/VisitPlanModal";
import { residentsApi, residentFollowUpsApi, referralsApi, visitPlansApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { manilaDateKey } from "@/features/follow-ups/lib/scheduleDates";
import { getResidentFollowUpPresentation } from "@/features/follow-ups/lib/residentFollowUpPresentation";

const formatLongDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const todayIso = () => manilaDateKey();

// The resident Health Services directory — the single, backend-driven source of
// truth for registration. Dashboard cards deep-link here so the resident can see
// requirements, schedule and deadline, then register.
const HEALTH_SERVICES_PATH = "/app/resident/health-services";

// Renders or manages ResidentDashboard logic.
export default function ResidentDashboard() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null); // { resident, riskLevel, lastConsultationDate, consultations }
  const [healthError, setHealthError] = useState("");
  const [followUps, setFollowUps] = useState([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(true);
  const [followUpsError, setFollowUpsError] = useState("");
  const [referrals, setReferrals] = useState([]);
  const [services, setServices] = useState(null); // null = not yet loaded; [] = loaded, none offered
  const [servicesError, setServicesError] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [detailsService, setDetailsService] = useState(null);
  const [registerModal, setRegisterModal] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState("");
  const [previewMemo, setPreviewMemo] = useState(null);
  const toastTimer = useRef(null);

  const loadServices = useCallback(async (showLoading = false) => {
    if (showLoading) setServicesLoading(true);
    setServicesError(false);
    try {
      const result = await visitPlansApi.directory();
      const facilities = result?.facilities || [];
      setServices(
        facilities.flatMap((facility) =>
          (facility.services || []).map((service) => ({
            ...service,
            facilityName: service.location || service.facilityName || facility.name,
            barangay: service.barangay || user?.barangay || facility.name,
          })),
        ),
      );
    } catch {
      setServicesError(true);
    } finally {
      if (showLoading) setServicesLoading(false);
    }
  }, [user?.barangay]);

  const patchServicePlan = useCallback((serviceId, plan) => {
    setServices((previous) => (previous || []).map((service) => (
      service.id === serviceId ? { ...service, plan } : service
    )));
  }, []);

  const showToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 4000);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const onPlanConfirmed = useCallback((plan) => {
    if (registerModal && plan) {
      patchServicePlan(registerModal.id, {
        id: plan.id,
        plannedDate: plan.plannedDate,
        note: plan.note || "",
        status: "Registered",
        attendanceStatus: null,
      });
    }
  }, [registerModal, patchServicePlan]);

  const confirmRemove = useCallback(async () => {
    if (!removeTarget?.plan?.id) return;
    setRemoving(true);
    try {
      await visitPlansApi.remove(removeTarget.plan.id);
      patchServicePlan(removeTarget.serviceId, null);
      showToast("Your registration has been cancelled.");
      setRemoveTarget(null);
    } catch (error) {
      showToast(error?.message || "Could not cancel your registration. Please try again.");
    } finally {
      setRemoving(false);
    }
  }, [removeTarget, patchServicePlan, showToast]);

  useEffect(() => {
    loadServices(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadServices();
    };
    const refreshInterval = window.setInterval(refreshWhenVisible, 5 * 60 * 1000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadServices]);

  useEffect(() => {
    if (!previewMemo) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreviewMemo(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewMemo]);

  const loadFollowUps = React.useCallback(() => {
    setFollowUpsLoading(true);
    setFollowUpsError("");
    return residentFollowUpsApi.list()
      .then((result) => setFollowUps(result?.rows || []))
      .catch((error) => setFollowUpsError(error?.message || "Unable to load follow-ups."))
      .finally(() => setFollowUpsLoading(false));
  }, []);

  useEffect(() => {
    loadFollowUps();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadFollowUps();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadFollowUps]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Each source is independent; a failure in one (e.g. referrals) must never
    // blank the whole dashboard, so they are settled individually.
    Promise.allSettled([residentsApi.myHealthRecords(), referralsApi.list()])
      .then(([healthRes, referralRes]) => {
        if (!active) return;
        if (healthRes.status === "fulfilled") {
          setHealth(healthRes.value || null);
          setHealthError("");
        } else {
          setHealthError("Unable to load your health record.");
        }
        if (referralRes.status === "fulfilled") setReferrals(referralRes.value?.rows || referralRes.value?.records || []);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const displayName = user?.name || health?.resident?.name || "Resident";
  const first = displayName.split(" ")[0];
  const dashboardServices = useMemo(() => (services || [])
    .filter((service) => {
      const status = String(service.status || "").toLowerCase();
      return service.active === true
        && service.availability?.open === true
        && service.registrationFull !== true
        && service.cancelled !== true
        && !["closed", "completed", "cancelled", "inactive"].includes(status);
    })
    .sort((a, b) => {
      const updatedAt = (service) => String(service.updatedAt || service.publishedAt || service.createdAt || "");
      return updatedAt(b).localeCompare(updatedAt(a));
    })
    .slice(0, 3), [services]);

  // Chronological, newest-first health timeline built from the resident's own
  // records (consultations, follow-ups, referrals). No internal ids, staff-only
  // remarks or other residents' data are included.
  const timeline = useMemo(() => {
    const events = [];
    const today = todayIso();
    (health?.consultations || []).forEach((c) => {
      if (!c.date || String(c.date).slice(0, 10) > today) return;
      events.push({
        date: c.date,
        type: "Health consultation",
        title: c.chiefComplaint || "Consultation recorded",
        desc: c.status ? c.status.replace(/\b\w/g, (m) => m.toUpperCase()) : "",
      });
      const measurements = [
        ["BP", c.vitals?.bloodPressure, "mmHg"],
        ["Pulse", c.vitals?.pulseRate, "bpm"],
        ["BMI", c.vitals?.bmi, ""],
      ]
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
        .map(([label, value, unit]) => `${label} ${value}${unit ? ` ${unit}` : ""}`);
      if (measurements.length) {
        events.push({
          date: c.date,
          type: "Vital signs",
          title: "Measurements recorded",
          desc: measurements.join(" · "),
        });
      }
    });
    (followUps || []).forEach((f) => {
      if (!f.scheduledDate || String(f.scheduledDate).slice(0, 10) > today) return;
      const presentation = getResidentFollowUpPresentation(f);
      events.push({ date: f.scheduledDate, type: "Follow-up", title: presentation.statusLabel, desc: f.location || "" });
    });
    (referrals || []).forEach((r) => {
      const date = r.referral_date || r.referralDate || r.created_at || r.createdAt;
      if (!date || String(date).slice(0, 10) > today) return;
      events.push({ date: String(date).slice(0, 10), type: "Referral", title: r.status || "Referral", desc: r.destination_facility || r.receiving_facility || "" });
    });
    return events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [health, followUps, referrals]);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 sm:gap-6">
      <PageHeader
        crumbs={["Dashboard"]}
        title={`Welcome back, ${first}`}
        subtitle="Here are your health updates and services that need your attention."
        action={(
          <div className="text-left md:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/75">Today</p>
            <p className="text-sm font-medium text-white">{formatLongDate(todayIso())}</p>
          </div>
        )}
      />

      <ResidentHealthSnapshot
        health={health}
        healthError={healthError}
        followUps={followUps}
        followUpsLoading={followUpsLoading}
        followUpsError={followUpsError}
        timeline={timeline}
        loading={loading}
      />

      <TransferStatusBanner />

      <section aria-labelledby="resident-services-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-gray dark:text-muted-foreground">Ongoing health services</p>
            <h2 id="resident-services-title" className="mt-1 font-display text-lg font-semibold leading-tight text-brand-ink dark:text-foreground sm:text-xl">Services available to your barangay</h2>
          </div>
          <Link
            to={HEALTH_SERVICES_PATH}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-brand-border px-3 py-2 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:text-blue-300 dark:hover:bg-blue-400/10"
          >
            View all <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
          </Link>
        </div>

        {servicesLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading health services" aria-busy="true">
            {[0, 1, 2].map((item) => (
              <div key={item} className="overflow-hidden rounded-lg border border-brand-border dark:border-border">
                <div className="h-40 animate-pulse bg-brand-blue/15" />
                <div className="space-y-3 p-4">
                  <div className="h-6 w-24 animate-pulse rounded-full bg-brand-light" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-brand-light" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-brand-light" />
                </div>
                <div className="border-t border-brand-border p-3 dark:border-border">
                  <div className="h-9 animate-pulse rounded-btn bg-brand-light" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!servicesLoading && servicesError && (
          <p className="rounded-lg border border-brand-border bg-white px-5 py-6 text-center text-sm text-brand-gray dark:border-border dark:bg-card dark:text-muted-foreground">
            We couldn't load your health services right now. Please refresh to try again.
          </p>
        )}

        {!servicesLoading && !servicesError && dashboardServices.length === 0 && (
          <div className="rounded-lg border border-dashed border-brand-border bg-white px-5 py-6 text-center dark:border-border dark:bg-card">
            <HeartPulse className="mx-auto h-5 w-5 text-brand-gray/60 dark:text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm text-brand-gray dark:text-muted-foreground">No available health services at the moment.</p>
          </div>
        )}

        {!servicesLoading && !servicesError && dashboardServices.length > 0 && (
          <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboardServices.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                bannerLocation={service.barangay}
                onViewDetails={() => setDetailsService(service)}
              />
            ))}
          </div>
        )}
      </section>

      <ServiceDetailsDialog
        service={detailsService}
        onClose={() => setDetailsService(null)}
        onRegister={(service) => { setDetailsService(null); setRegisterModal(service); }}
        onCancel={(service) => { setDetailsService(null); setRemoveTarget({ serviceId: service.id, plan: service.plan }); }}
        onPreviewMemo={setPreviewMemo}
      />

      <VisitPlanModal
        open={Boolean(registerModal)}
        service={registerModal}
        onClose={() => setRegisterModal(null)}
        onConfirmed={onPlanConfirmed}
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
        <div role="status" className="fixed bottom-4 right-4 z-[80] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <span className="text-sm">{toast}</span>
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
    </div>
  );
}
