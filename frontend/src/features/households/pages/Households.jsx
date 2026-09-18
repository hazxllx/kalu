import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import {
  Users,
  Droplet,
  Home,
  Wallet,
  Layers,
  Plus,
  RefreshCw,
  X,
  Trash2,
  UserPlus,
  Search,
  Filter,
  LayoutGrid,
  Table2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ClipboardList,
  Eye,
} from "lucide-react";
import HHBadge from "../components/HHBadge";
import { householdsApi, intakeApi } from "@/services/api";
import {
  HH_STATUSES,
  APPROVAL_STATUSES,
  PUROKS,
  RELATIONSHIPS,
  WATER_SOURCE_LABELS,
  TOILET_LABELS,
  CLASSIFICATIONS,
} from "../lib/householdOptions";

const COLUMNS = [
  { key: "id", label: "Household ID", filter: "text", placeholder: "Filter ID..." },
  { key: "head", label: "Household Head", filter: "text", placeholder: "Filter name..." },
  { key: "purok", label: "Purok/Zone", filter: "list", options: PUROKS },
  { key: "streetAddress", label: "Street Address / Sitio", filter: "text", placeholder: "Filter address..." },
  { key: "hhStatus", label: "HH Status", filter: "list", options: HH_STATUSES },
  { key: "collector", label: "Assigned Data Collector", filter: "text", placeholder: "Filter collector..." },
  { key: "verification", label: "Verification", filter: "list", options: ["Pending Verification", "Verified", "Returned for Correction"] },
  { key: "approval", label: "Approval Status", filter: "list", options: APPROVAL_STATUSES },
  { key: "risk", label: "Risk Level", filter: "list", options: ["Low", "Moderate", "High"] },
];

const EMPTY_FILTERS = {
  id: "",
  head: "",
  purok: [],
  streetAddress: "",
  hhStatus: [],
  collector: "",
  verification: [],
  approval: [],
  risk: [],
};

/** Verification badge tones shown for gathered-data review status. */
const VERIFICATION_TONES = {
  "Pending Verification": "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Verified: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  "Returned for Correction": "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

/** Column header filter — text search or a dropdown of status options. */
function ColumnFilter({ type = "list", options = [], value, onChange, placeholder, columnLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeCount = type === "list" ? value.length : value ? 1 : 0;

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
          activeCount > 0
            ? "bg-brand-blue/10 text-brand-blue"
            : "text-brand-gray/70 hover:bg-brand-bg hover:text-brand-ink"
        }`}
        aria-label={`Filter ${columnLabel}`}
        title={`Filter ${columnLabel}`}
      >
        <Filter className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-48 rounded-btn border border-brand-border bg-white p-2 shadow-float">
          {type === "text" ? (
            <input
              autoFocus
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-input border border-brand-border px-2.5 py-1.5 text-xs text-brand-ink outline-none focus:border-brand-blue"
            />
          ) : (
            <>
              <div className="max-h-52 space-y-0.5 overflow-y-auto">
                {options.map((o) => (
                  <label
                    key={o}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-brand-ink hover:bg-brand-bg"
                  >
                    <input
                      type="checkbox"
                      checked={value.includes(o)}
                      onChange={() =>
                        onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o])
                      }
                      className="h-3.5 w-3.5 accent-brand-blue"
                    />
                    {o}
                  </label>
                ))}
              </div>
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="mt-1 w-full rounded-btn px-2 py-1 text-xs font-medium text-brand-blue hover:bg-brand-light"
                >
                  Clear filter
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const detailCell = (label, value) => (
  <div>
    <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
    <p className="mt-0.5 text-sm font-medium text-brand-ink">{value || "—"}</p>
  </div>
);

/**
 * Household Profiling list (BHW / Health Supervisor).
 *
 * Backed by the real API (GET/POST/PUT /api/households, member management):
 * scope is enforced server-side (barangay for BHW/HS, municipality for PHN),
 * risk classification is computed by the backend, and loading / error /
 * differentiated empty states render from the request lifecycle. No mock data.
 */
export default function Households() {
  const navigate = useNavigate();
  const location = useLocation();

  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState("table");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "id", dir: "asc" });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // Detail modal (household info + member management).
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberForm, setMemberForm] = useState({ name: "", relationship: "", sex: "", age: "", classification: "", isPwd: false });
  const [memberError, setMemberError] = useState(null);
  const [memberSaving, setMemberSaving] = useState(false);
  const [residentResults, setResidentResults] = useState([]);
  const [residentSearching, setResidentSearching] = useState(false);
  const [linkedResidentId, setLinkedResidentId] = useState(null);
  const memberSearchRef = useRef(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  };

  /** Load the household list from the API (search term applied server-side). */
  const load = useCallback(async (searchTerm = "") => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await householdsApi.list({ q: searchTerm, limit: 100 });
      setHouseholds(result?.rows || []);
    } catch (err) {
      setHouseholds([]);
      setLoadError(err?.message || "Could not load households.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  // Debounced server-side search.
  const debounceRef = useRef(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(search.trim());
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search, load]);

  // After the Add Household page saves, it returns here with a toast message.
  useEffect(() => {
    const message = location.state?.hhToast;
    if (!message) return undefined;
    setToast(message);
    const timer = setTimeout(() => setToast(null), 3000);
    window.history.replaceState({}, "");
    return () => clearTimeout(timer);
  }, [location.state]);

  const openAddPage = () => navigate(`${location.pathname.replace(/\/+$/, "")}/new`);

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const toggleSort = (key) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = households.filter((h) => {
      if (filters.id && !String(h.id || "").toLowerCase().includes(filters.id.toLowerCase())) return false;
      if (filters.head && !String(h.head || "").toLowerCase().includes(filters.head.toLowerCase())) return false;
      if (filters.streetAddress && !String(h.streetAddress || "").toLowerCase().includes(filters.streetAddress.toLowerCase()))
        return false;
      if (filters.purok.length && !filters.purok.includes(h.purok)) return false;
      if (filters.hhStatus.length && !filters.hhStatus.includes(h.hhStatus)) return false;
      if (filters.collector && !String(h.collector || "").toLowerCase().includes(filters.collector.toLowerCase())) return false;
      if (filters.approval.length && !filters.approval.includes(h.approval)) return false;
      const verificationStatus = h.verificationStatus || "Pending Verification";
      if (filters.verification.length && !filters.verification.includes(verificationStatus)) return false;
      if (filters.risk.length && !filters.risk.includes(h.riskLevel || "Low")) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      let av;
      let bv;
      if (sort.key === "risk") {
        av = a.riskScore ?? 0;
        bv = b.riskScore ?? 0;
      } else {
        av = String(a[sort.key] ?? "").toLowerCase();
        bv = String(b[sort.key] ?? "").toLowerCase();
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [households, search, filters, sort]);

  const activeFilterCount =
    COLUMNS.reduce(
      (acc, c) =>
        acc + (c.filter === "text" ? (filters[c.key] ? 1 : 0) : filters[c.key].length),
      0
    ) + (search ? 1 : 0);

  const hasSearchOrFilters = activeFilterCount > 0;

  /* ----------------------- detail modal (members) ------------------------ */

  const openDetail = async (id) => {
    setDetailId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setShowAddMember(false);
    setMemberError(null);
    setLinkedResidentId(null);
    setMemberForm({ name: "", relationship: "", sex: "", age: "", classification: "", isPwd: false });
    try {
      const result = await householdsApi.get(id);
      setDetail(result?.household || null);
    } catch (err) {
      setDetailError(err?.message || "Could not load household details.");
    } finally {
      setDetailLoading(false);
    }
  };

  const searchResidents = async (term) => {
    setMemberForm((p) => ({ ...p, name: term }));
    setLinkedResidentId(null);
    if (!term || term.trim().length < 2) {
      setResidentResults([]);
      return;
    }
    setResidentSearching(true);
    try {
      const results = await intakeApi.searchResidents(term.trim());
      setResidentResults(results.slice(0, 6));
    } catch {
      setResidentResults([]);
    } finally {
      setResidentSearching(false);
    }
  };

  const pickResident = (resident) => {
    setLinkedResidentId(resident.id);
    setMemberForm((p) => ({
      ...p,
      name: [resident.firstName, resident.middleName, resident.lastName].filter(Boolean).join(" "),
      sex: resident.sex || "",
    }));
    setResidentResults([]);
  };

  const saveMember = async () => {
    if (!detail) return;
    if (!memberForm.name.trim() || !memberForm.relationship || !memberForm.sex) {
      setMemberError("Name, relationship to head, and sex are required.");
      return;
    }
    setMemberSaving(true);
    setMemberError(null);
    try {
      await householdsApi.addMember(detail.id, {
        name: memberForm.name.trim(),
        relationship: memberForm.relationship,
        sex: memberForm.sex,
        age: memberForm.age === "" ? null : Number(memberForm.age),
        classification: memberForm.classification,
        isPwd: memberForm.isPwd,
        residentId: linkedResidentId || undefined,
      });
      setShowAddMember(false);
      setMemberForm({ name: "", relationship: "", sex: "", age: "", classification: "", isPwd: false });
      setLinkedResidentId(null);
      setResidentResults([]);
      const result = await householdsApi.get(detail.id);
      setDetail(result?.household || null);
      await load(search.trim());
      showToast("Household member added.");
    } catch (err) {
      setMemberError(err?.message || "Could not add the household member.");
    } finally {
      setMemberSaving(false);
    }
  };

  const removeMember = async (member) => {
    if (!detail) return;
    try {
      await householdsApi.removeMember(detail.id, member.id);
      const result = await householdsApi.get(detail.id);
      setDetail(result?.household || null);
      await load(search.trim());
      showToast("Household member removed.");
    } catch (err) {
      showToast(err?.message || "Could not remove the household member.");
    }
  };

  const closeModal = () => {
    setDetailId(null);
    setDetail(null);
  };

  /* -------------------------------- render -------------------------------- */

  const renderRow = (h) => ({
    ...h,
    head: h.headName,
    collector: h.collectorName,
    approval: h.approvalStatus,
  });

  return (
    <>
      <PageHeader
        crumbs={["Household Profiling"]}
        title="Household Profiling"
        subtitle="Household conditions and risk classification across the barangay."
        action={
          <button
            onClick={openAddPage}
            className="flex items-center gap-2 bg-brand-blue px-5 py-2.5 text-sm font-medium text-white rounded-btn transition-colors hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> Add Household
          </button>
        }
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex animate-in slide-in-from-bottom-2 items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          <RefreshCw className="h-4 w-4 text-brand-green" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}

      {/* Search / view toolbar */}
      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex w-full items-center gap-2 rounded-input border border-brand-border bg-brand-bg px-3 py-2.5 md:max-w-sm">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search households, heads, collectors..."
              className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/50"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-brand-gray">
              {visible.length} of {households.length} households
              {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} active`}
            </span>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setSearch("");
                }}
                className="text-sm font-medium text-brand-blue hover:underline"
              >
                Clear all
              </button>
            )}
            <div className="flex overflow-hidden rounded-btn border border-brand-border">
              <button
                onClick={() => setView("table")}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  view === "table" ? "bg-brand-blue text-white" : "bg-white text-brand-gray hover:bg-brand-bg"
                }`}
              >
                <Table2 className="h-3.5 w-3.5" /> Table
              </button>
              <button
                onClick={() => setView("cards")}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  view === "cards" ? "bg-brand-blue text-white" : "bg-white text-brand-gray hover:bg-brand-bg"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Cards
              </button>
            </div>
          </div>
        </div>
      </Card>

      {loadError && (
        <Card className="mb-5">
          <ErrorState
            title="Unable to load households"
            message={loadError}
            onRetry={() => load(search.trim())}
          />
        </Card>
      )}

      {loading && (
        <Card className="p-5">
          <SkeletonList rows={6} />
        </Card>
      )}

      {!loadError && !loading && households.length === 0 && (
        <Card>
          <EmptyState
            icon={Home}
            title="No households yet"
            description="Household records will appear here once they are registered."
            action={
              <button
                onClick={openAddPage}
                className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                <Plus className="h-4 w-4" /> Add Household
              </button>
            }
          />
        </Card>
      )}

      {!loadError && !loading && households.length > 0 && visible.length === 0 && (
        <Card>
          <EmptyState
            icon={Search}
            title="No matching households"
            description={
              search
                ? "Try a different household ID, resident name, or search term."
                : "Try clearing one or more filters to see more household records."
            }
            action={
              <button
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setSearch("");
                }}
                className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                {search ? "Clear Search" : "Reset Filters"}
              </button>
            }
          />
        </Card>
      )}

      {!loadError && !loading && visible.length > 0 && view === "table" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg text-left">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap px-4 py-3 text-xs font-medium uppercase text-brand-gray"
                    >
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => toggleSort(c.key)}
                          className="flex items-center gap-1 transition-colors hover:text-brand-ink"
                          title={`Sort by ${c.label}`}
                        >
                          {c.label}
                          {sort.key === c.key ? (
                            sort.dir === "asc" ? (
                              <ChevronUp className="h-3 w-3 text-brand-blue" />
                            ) : (
                              <ChevronDown className="h-3 w-3 text-brand-blue" />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                        {c.filter && (
                          <ColumnFilter
                            type={c.filter}
                            options={c.options}
                            placeholder={c.placeholder}
                            columnLabel={c.label}
                            value={filters[c.key]}
                            onChange={(v) => setFilter(c.key, v)}
                          />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((raw) => {
                  const h = renderRow(raw);
                  const verificationTitle = h.verifiedBy
                    ? `Reviewed by ${h.verifiedBy}${h.verifiedAt ? ", " + new Date(h.verifiedAt).toLocaleDateString() : ""}`
                    : "Not yet reviewed";
                  return (
                    <tr
                      key={h.id}
                      onClick={() => openDetail(h.id)}
                      className="cursor-pointer border-b border-brand-border transition-colors last:border-0 hover:bg-brand-bg/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-brand-ink">{h.id}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-brand-ink">{h.head}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-brand-gray">{h.purok}</td>
                      <td className="px-4 py-3 text-brand-gray">{h.streetAddress}</td>
                      <td className="px-4 py-3">
                        <HHBadge value={h.hhStatus} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-brand-gray">{h.collector || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            title={verificationTitle}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${VERIFICATION_TONES[h.verificationStatus] || VERIFICATION_TONES["Pending Verification"]}`}
                          >
                            <span className="h-2 w-2 rounded-full bg-current opacity-70" />
                            {h.verificationStatus || "Pending Verification"}
                          </span>
                          {h.correctionReason && (
                            <span className="max-w-[16rem] truncate text-[11px] text-brand-gray" title={h.correctionReason}>
                              {h.correctionReason}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <HHBadge value={h.approval} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <HHBadge value={h.riskLevel || "Low"} label={`${h.riskLevel || "Low"} Risk`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loadError && !loading && visible.length > 0 && view === "cards" && (
        <div className="grid gap-5 md:grid-cols-2">
          {visible.map((raw, i) => {
            const h = renderRow(raw);
            const treatment = Array.isArray(h.treatmentMethods) && h.treatmentMethods.length
              ? h.treatmentMethods.join(", ")
              : "None";
            return (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
              >
                <Card className="h-full p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-brand-gray">{h.id}</p>
                      <h3 className="mt-0.5 font-semibold text-brand-ink">{h.head}</h3>
                      <p className="mt-0.5 text-xs text-brand-gray">
                        {h.purok} · {h.streetAddress}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <HHBadge value={h.riskLevel || "Low"} label={`${h.riskLevel || "Low"} Risk`} />
                      <HHBadge value={h.hhStatus} />
                      <span
                        title={h.verifiedBy ? "Reviewed by " + h.verifiedBy : "Not yet reviewed"}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${VERIFICATION_TONES[h.verificationStatus] || VERIFICATION_TONES["Pending Verification"]}`}
                      >
                        <span className="h-2 w-2 rounded-full bg-current opacity-70" />
                        {h.verificationStatus || "Pending Verification"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Users className="h-4 w-4 text-brand-blue" /> {h.memberCount ?? 0} members
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Layers className="h-4 w-4 text-brand-blue" /> {h.families || 1} famil{(h.families || 1) === 1 ? "y" : "ies"}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Wallet className="h-4 w-4 text-brand-blue" />{" "}
                      {h.monthlyIncome ? `₱${Number(h.monthlyIncome).toLocaleString()}/mo` : "—"}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Droplet className="h-4 w-4 text-brand-blue" /> {WATER_SOURCE_LABELS[h.waterSource] || "—"}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Home className="h-4 w-4 text-brand-blue" /> {TOILET_LABELS[h.toiletType] || "—"}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <ClipboardList className="h-4 w-4 text-brand-blue" /> {h.collector || "—"}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(h.flags || []).map((c) => (
                      <span key={c} className="rounded-full bg-brand-light px-2.5 py-1 text-xs text-brand-blue">
                        {c}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => openDetail(h.id)}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                  >
                    <Eye className="h-4 w-4" /> View details
                  </button>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Household detail modal — info + member management */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeModal}>
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
            <div onClick={(e) => e.stopPropagation()} className="p-6">
              {detailLoading && <SkeletonList rows={5} />}
              {detailError && (
                <ErrorState
                  title="Unable to load household details"
                  message={detailError}
                  onRetry={() => openDetail(detailId)}
                />
              )}
              {detail && (
                <>
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-brand-gray">{detail.id}</p>
                      <h3 className="text-lg font-semibold text-brand-ink">{detail.headName}</h3>
                      <p className="mt-0.5 text-xs text-brand-gray">
                        {detail.purok} · {detail.streetAddress} · Brgy. {detail.barangay}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <HHBadge value={detail.riskLevel || "Low"} label={`${detail.riskLevel || "Low"} Risk`} />
                      <HHBadge value={detail.hhStatus} />
                      <button onClick={closeModal} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                      Household Information
                    </p>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      {detailCell("Members", detail.members?.length ?? 0)}
                      {detailCell("Families", detail.families)}
                      {detailCell("Monthly Income", detail.monthlyIncome ? `₱${Number(detail.monthlyIncome).toLocaleString()}` : "—")}
                      {detailCell("Water Source", WATER_SOURCE_LABELS[detail.waterSource] || "—")}
                      {detailCell("Toilet", TOILET_LABELS[detail.toiletType] || "—")}
                      {detailCell("Sanitation Access", detail.sanitationAccess)}
                      {detailCell("Waste Disposal", detail.wasteDisposal)}
                      {detailCell("Data Collector", detail.collectorName)}
                      {detailCell(
                        "Registered",
                        detail.createdAt ? new Date(detail.createdAt).toLocaleDateString() : "—"
                      )}
                    </div>
                    {Array.isArray(detail.riskFactors) && detail.riskFactors.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {detail.riskFactors.map((f) => (
                          <span key={f} className="rounded-full bg-brand-light px-2.5 py-1 text-xs text-brand-blue">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                        Household Members ({detail.members?.length ?? 0})
                      </p>
                      <button
                        onClick={() => {
                          setShowAddMember((v) => !v);
                          setMemberError(null);
                        }}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                      >
                        <UserPlus className="h-4 w-4" /> Add member
                      </button>
                    </div>

                    {showAddMember && (
                      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                        <div ref={memberSearchRef} className="relative grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <label className="text-sm font-medium text-brand-ink">
                              Resident (search to link an existing record)
                            </label>
                            <input
                              value={memberForm.name}
                              onChange={(e) => searchResidents(e.target.value)}
                              placeholder="Search residents by name…"
                              className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
                            />
                            {residentSearching && (
                              <p className="mt-1 text-xs text-brand-gray">Searching…</p>
                            )}
                            {residentResults.length > 0 && (
                              <div className="absolute z-20 mt-1 w-full rounded-btn border border-brand-border bg-white shadow-float">
                                {residentResults.map((r) => (
                                  <button
                                    key={r.id}
                                    onClick={() => pickResident(r)}
                                    className="block w-full px-3.5 py-2.5 text-left text-sm hover:bg-brand-bg"
                                  >
                                    <span className="font-medium text-brand-ink">
                                      {[r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ")}
                                    </span>
                                    <span className="ml-2 text-xs text-brand-gray">
                                      {r.barangay} {r.healthRecordNo ? `· ${r.healthRecordNo}` : ""}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {linkedResidentId && (
                              <p className="mt-1 text-xs font-medium text-brand-green">
                                Linked to resident record {linkedResidentId}.
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="text-sm font-medium text-brand-ink">Relationship to head *</label>
                            <select
                              value={memberForm.relationship}
                              onChange={(e) => setMemberForm((p) => ({ ...p, relationship: e.target.value }))}
                              className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
                            >
                              <option value="">Select…</option>
                              {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-sm font-medium text-brand-ink">Sex *</label>
                            <select
                              value={memberForm.sex}
                              onChange={(e) => setMemberForm((p) => ({ ...p, sex: e.target.value }))}
                              className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
                            >
                              <option value="">Select…</option>
                              <option>Male</option>
                              <option>Female</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-sm font-medium text-brand-ink">Age</label>
                            <input
                              type="number"
                              min="0"
                              max="120"
                              value={memberForm.age}
                              onChange={(e) => setMemberForm((p) => ({ ...p, age: e.target.value }))}
                              className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium text-brand-ink">Classification</label>
                            <select
                              value={memberForm.classification}
                              onChange={(e) => setMemberForm((p) => ({ ...p, classification: e.target.value }))}
                              className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
                            >
                              <option value="">Select…</option>
                              {CLASSIFICATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                          </div>
                          {memberError && (
                            <p className="text-xs font-medium text-brand-danger sm:col-span-2">{memberError}</p>
                          )}
                          <div className="flex justify-end gap-2 sm:col-span-2">
                            <button
                              onClick={() => setShowAddMember(false)}
                              className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveMember}
                              disabled={memberSaving}
                              className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                            >
                              {memberSaving ? "Adding…" : "Add Member"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {detail.members && detail.members.length > 0 ? (
                      <div className="divide-y divide-slate-100">
                        {detail.members.map((m) => (
                          <div key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-brand-ink">
                                {m.name}
                                {m.isHead && <span className="ml-2 text-[10px] font-bold uppercase text-brand-blue">Head</span>}
                                {m.residentId && (
                                  <span className="ml-2 text-[10px] font-medium uppercase text-brand-green">Linked</span>
                                )}
                              </p>
                              <p className="text-xs text-brand-gray">
                                {[m.relationship, m.sex, m.age !== null && m.age !== undefined ? `${m.age} yrs` : "", m.classification]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                            <button
                              onClick={() => removeMember(m)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-brand-gray transition-colors hover:text-brand-danger"
                              aria-label={`Remove ${m.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon={Users}
                        title="No household members"
                        description="Add household members to build the household roster."
                        className="py-6"
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
