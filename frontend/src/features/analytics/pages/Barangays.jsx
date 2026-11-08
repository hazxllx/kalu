import React, { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonStatGrid } from "@/components/common/Skeleton";
import RiskOverview from "@/features/analytics/components/RiskOverview";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import { useAuth } from "@/context/AuthContext";
import { barangaysApi } from "@/services/api/barangaysApi";
import { authorizedViewsApi } from "@/services/api/authorizedViewsApi";
import { getBarangayHealthOverview } from "@/services/api/monitoringApi";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { metricValue } from "@/lib/legacyAnalytics";
import { captureOwnerGuard } from "@/services/offline/db";
import { MapPin, Plus, X, RefreshCw } from "lucide-react";

const blank = () => ({ name: "", municipalityId: "", captain: "", contact: "", healthStationName: "", latitude: "", longitude: "", status: "Active" });
const input = "w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue";

export default function Barangays() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const assigned = getAssignedBarangay(user);
  const missingAssignment = user?.role === "health_supervisor" && !assigned;
  const load = useCallback(async (options) => {
    if (missingAssignment) return { rows: [], municipalities: [], overview: null };
    if (admin) {
      const [list, reference] = await Promise.all([barangaysApi.list({}, options), barangaysApi.options(options)]);
      if (!Array.isArray(list?.barangays) || !Array.isArray(reference?.municipalities)) throw new Error("The barangay registry response was incomplete.");
      return { rows: list.barangays, municipalities: reference.municipalities, overview: null };
    }
    const [map, ew] = await Promise.all([authorizedViewsApi.communityMap({ barangay: assigned }, options), authorizedViewsApi.earlyWarning({ barangay: assigned }, options)]);
    const overview = await getBarangayHealthOverview(assigned, { load: () => Promise.resolve(ew) });
    return { rows: map.barangays, municipalities: [], overview };
  }, [admin, assigned, missingAssignment]);
  const resource = useAuthorizedData(load);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blank);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const detailLoad = useCallback(async (options) => {
    if (!selected) return null;
    if (admin) {
      const result = await barangaysApi.get(selected.id, options);
      if (!result?.barangay?.id || String(result.barangay.id) !== String(selected.id)) throw new Error("The selected registry record was not confirmed.");
      return result;
    }
    const ew = await authorizedViewsApi.earlyWarning({ barangay: selected.name }, options);
    return { barangay: selected, overview: await getBarangayHealthOverview(selected.name, { load: () => Promise.resolve(ew) }), ew };
  }, [selected, admin]);
  const detail = useAuthorizedData(detailLoad);
  useEffect(() => { setSelected(null); setShowAdd(false); setForm(blank()); setFailure(""); setNotice(""); }, [user?.id]);
  const save = async () => {
    if (busy || !admin) return;
    if (!form.name.trim() || !resource.data.municipalities.some((municipality) => municipality.id === form.municipalityId)) { setFailure("Enter a name and select a real municipality from the server registry."); return; }
    for (const [key, minimum, maximum] of [["latitude", -90, 90], ["longitude", -180, 180]]) {
      if (form[key] !== "" && (!Number.isFinite(Number(form[key])) || Number(form[key]) < minimum || Number(form[key]) > maximum)) { setFailure(`Invalid ${key}.`); return; }
    }
    const guard = captureOwnerGuard(user.id);
    setBusy(true); setFailure("");
    try {
      const result = await barangaysApi.create({ ...form, name: form.name.trim(), latitude: form.latitude === "" ? null : Number(form.latitude), longitude: form.longitude === "" ? null : Number(form.longitude) }, { ownerId: user.id });
      if (!guard()) return;
      if (!result?.barangay?.id) throw new Error("The server did not confirm the saved barangay. Refresh before retrying.");
      setShowAdd(false); setForm(blank()); setNotice(`${result.barangay.name} was saved by the server.`);
      await resource.refresh();
    } catch (error) { if (guard()) setFailure(error?.message || "The barangay was not saved."); }
    finally { setBusy(false); }
  };
  const rows = resource.data?.rows || [];
  const metrics = resource.data?.overview?.metrics;
  return <>
    <PageHeader crumbs={["Monitoring", "Barangays"]} title={assigned ? `My Barangay: ${assigned}` : "Barangay Health Profiles"} subtitle={admin ? "Administrator-managed server registry. Health indicators require the authorized analytics source." : "Health indicators from scoped server aggregates; registration remains administrator-managed."} action={<div className="flex gap-2"><button disabled={resource.loading} onClick={resource.refresh} className="rounded-btn border border-brand-border p-2"><RefreshCw className="h-4 w-4" /></button>{admin && <button disabled={resource.loading || Boolean(resource.error)} onClick={() => { setForm(blank()); setFailure(""); setShowAdd(true); }} className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Register Barangay</button>}</div>} />
    {notice && <p role="status" className="mb-4 rounded-btn border border-brand-green/30 p-3 text-sm">{notice}</p>}
    {resource.loading ? <SkeletonStatGrid count={4} /> : resource.error ? <ErrorState message={resource.error} onRetry={resource.refresh} /> : missingAssignment ? <Card className="p-6 text-sm text-brand-gray">No barangay is assigned to your account. A municipality administrator must update the authoritative profile; no wider list has been substituted.</Card> : <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Authorized Barangay Profiles" value={rows.length} icon="Map" /><StatCard label="Registered Residents" value={metricValue(metrics?.totalResidents)} icon="Users" /><StatCard label="Recorded High-Risk Residents" value={metricValue(metrics?.residentRisk?.high)} icon="AlertTriangle" tone="danger" /><StatCard label="Immunization Records" value={metricValue(metrics?.immunizationRecords)} icon="Syringe" tone="green" /></div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{rows.map((barangay) => <Card key={barangay.id} className="p-5"><div className="flex items-center gap-2"><MapPin className="h-5 w-5 text-brand-blue" /><h2 className="font-semibold">{barangay.name}</h2></div><p className="mt-2 text-xs text-brand-gray">{barangay.municipality || user?.municipality || "Municipality not supplied"}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-brand-gray">Registered Residents</p><p className="font-semibold">{metricValue(barangay.residents)}</p></div><div><p className="text-xs text-brand-gray">Recorded High Risk</p><p className="font-semibold">{metricValue(barangay.highRiskResidents)}</p></div></div><button onClick={() => setSelected(barangay)} className="mt-5 text-sm font-medium text-brand-blue">View Authorized Profile</button></Card>)}</div>{rows.length === 0 && <Card className="p-8 text-center text-sm text-brand-gray">No authorized barangay profiles were returned.</Card>}
    </>}
    {showAdd && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><Card role="dialog" aria-modal="true" className="w-full max-w-xl max-h-[90vh] overflow-y-auto p-6"><div className="mb-5 flex justify-between"><h2 className="font-semibold">Register Server Barangay</h2><button disabled={busy} onClick={() => setShowAdd(false)} aria-label="Close"><X className="h-5 w-5" /></button></div>{failure && <p role="alert" className="mb-4 text-sm text-brand-danger">{failure}</p>}<div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-brand-gray">Municipality<select value={form.municipalityId} onChange={(event) => setForm({ ...form, municipalityId: event.target.value })} className={`${input} mt-1`}><option value="">Select server municipality...</option>{resource.data?.municipalities.map((municipality) => <option key={municipality.id} value={municipality.id}>{municipality.name} · {municipality.province}</option>)}</select></label>{["name", "captain", "contact", "healthStationName", "latitude", "longitude"].map((key) => <label key={key} className="text-xs capitalize text-brand-gray">{key.replace(/([A-Z])/g, " $1")}<input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className={`${input} mt-1`} /></label>)}</div><p className="mt-4 text-xs text-brand-gray">The server permits approved active barangays only. Province comes from the selected municipality. Worker assignment and clinical coverage are not fabricated or stored by this registration form.</p><div className="mt-5 flex justify-end gap-3"><button disabled={busy} onClick={() => setShowAdd(false)} className="rounded-btn border border-brand-border px-4 py-2 text-sm">Cancel</button><button disabled={busy || resource.loading || Boolean(resource.error)} onClick={save} className="rounded-btn bg-brand-blue px-5 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving..." : "Save Server Record"}</button></div></Card></div>}
    {selected && <div className="fixed inset-0 z-50 flex justify-end"><button onClick={() => setSelected(null)} className="absolute inset-0 bg-black/50" aria-label="Close profile" /><aside role="dialog" aria-modal="true" className="relative h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl"><div className="mb-5 flex justify-between"><h2 className="text-lg font-semibold">{selected.name}</h2><button onClick={() => setSelected(null)} aria-label="Close"><X className="h-5 w-5" /></button></div>{detail.loading ? <SkeletonStatGrid count={4} /> : detail.error ? <ErrorState message={detail.error} onRetry={detail.refresh} /> : detail.data && <>
      <Card className="mb-5 p-4"><h3 className="mb-3 text-sm font-semibold">Recorded Barangay Information</h3>{[["Server ID", detail.data.barangay.id], ["Captain", detail.data.barangay.captain], ["Contact", detail.data.barangay.contact], ["Health Station", detail.data.barangay.healthStationName], ["Registry Status", detail.data.barangay.status]].map(([label, value]) => <div key={label} className="mb-3"><p className="text-xs text-brand-gray">{label}</p><p className="break-all text-sm">{value || "Not supplied by this authorized source"}</p></div>)}</Card>
      {detail.data.dependencies && <Card className="p-4"><h3 className="mb-3 text-sm font-semibold">Linked Server Records</h3>{Object.entries(detail.data.dependencies).filter(([name]) => name !== "total").map(([name, count]) => <p key={name} className="mb-2 text-sm capitalize">{name}: {metricValue(count)}</p>)}</Card>}
      {detail.data.overview && <><div className="mb-5 grid grid-cols-2 gap-3">{[["Households", detail.data.overview.metrics.totalHouseholds], ["Active Follow-ups", detail.data.overview.metrics.activeFollowUps], ["Pending Referrals", detail.data.overview.metrics.pendingReferrals], ["Maternal Cases", detail.data.overview.metrics.maternalCases], ["Immunization Records", detail.data.overview.metrics.immunizationRecords]].map(([label, count]) => <Card key={label} className="p-3"><p className="text-xs text-brand-gray">{label}</p><p className="text-xl font-semibold">{metricValue(count)}</p></Card>)}</div><RiskOverview distribution={detail.data.ew.riskDistribution} highRisk={detail.data.overview.metrics.residentRisk.high} moderateRisk={detail.data.overview.metrics.residentRisk.moderate} lowRisk={detail.data.overview.metrics.residentRisk.low} totalResidents={detail.data.overview.metrics.totalResidents} assignedBarangay={selected.name} /></>}
      <p className="mt-4 text-xs text-brand-gray">Official vaccination eligibility, program compliance and worker rosters are not returned by this profile source. Missing values are not treated as zero.</p>
    </>}</aside></div>}
  </>;
}
