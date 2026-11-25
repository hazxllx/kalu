import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import TablePagination from "@/components/tables/TablePagination";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { ButtonSelectGroup } from "@/components/system";
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
  HeartPulse,
} from "lucide-react";
import HHBadge from "../components/HHBadge";
import { canonicalRiskLevel } from "@/lib/riskLevel";
import MemberHealthModal from "../components/MemberHealthModal";
import HouseholdDialog from "../components/HouseholdDialog";
import * as Popover from "@radix-ui/react-popover";
import {
  getHouseholdOffline,
  listHouseholdsOffline,
} from "@/services/offline/householdOfflineService";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { useSyncStatus } from "@/hooks/useSyncStatus";
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
import { householdLoadErrorMessage } from "../lib/householdLoadError";

const COLUMNS = [
  { key: "id", label: "Household ID", filter: "text", placeholder: "Filter ID..." },
  { key: "head", label: "Household Head", filter: "text", placeholder: "Filter name..." },
  { key: "purok", label: "Purok/Zone", filter: "list", options: PUROKS },
  { key: "streetAddress", label: "Street Address / Sitio", filter: "text", placeholder: "Filter address..." },
  { key: "hhStatus", label: "HH Status", filter: "list", options: HH_STATUSES },
  { key: "collector", label: "Assigned Data Collector", filter: "text", placeholder: "Filter collector..." },
  { key: "verification", label: "Verification", filter: "list", options: ["Pending Verification", "Verified", "Returned for Correction"] },
  { key: "approval", label: "Approval Status", filter: "list", options: APPROVAL_STATUSES },
  { key: "risk", label: "Risk Level", filter: "list", options: ["Low", "Moderate", "High", "Unassessed"] },
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
const HOUSEHOLD_PAGE_SIZE = 100;
const formatVisitDate = (value) => {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};
const formatWorkflowDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
};

/** Verification badge tones shown for gathered-data review status. */
const VERIFICATION_TONES = {
  "Pending Verification": "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Verified: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  "Returned for Correction": "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

/**
 * Login-account status for a household member, derived server-side from the
 * linked resident's auth user (none when the member has no linked resident or
 * the resident has no account). A resident profile never requires an account,
 * so "No Account" is a normal, valid state.
 */
const ACCOUNT_BADGE = {
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700" },
  pending: { label: "Pending Activation", className: "bg-amber-50 text-amber-700" },
  disabled: { label: "Disabled", className: "bg-rose-50 text-rose-700" },
  none: { label: "No Account", className: "bg-slate-100 text-slate-500" },
};

function AccountBadge({ status }) {
  const meta = ACCOUNT_BADGE[status] || ACCOUNT_BADGE.none;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`} title="Login account">
      {meta.label}
    </span>
  );
}

/** Column header filter — text search or a dropdown of status options. */
function ColumnFilter({ type = "list", options = [], value, onChange, placeholder, columnLabel }) {
  const [open, setOpen] = useState(false);

  const activeCount = type === "list" ? value.length : value ? 1 : 0;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
      <button
        type="button"
        className={`flex h-11 w-11 items-center justify-center rounded transition-colors ${
          activeCount > 0
            ? "bg-brand-blue/10 text-brand-blue"
            : "text-brand-gray/70 hover:bg-brand-bg hover:text-brand-ink"
        }`}
        aria-label={`Filter ${columnLabel}`}
        aria-expanded={open}
        title={`Filter ${columnLabel}`}
      >
        <Filter className="h-3 w-3" />
      </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={12} aria-label={`Filter ${columnLabel}`} className="z-40 max-h-[var(--radix-popover-content-available-height)] w-48 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-btn border border-brand-border bg-white p-2 shadow-float">
          {type === "text" ? (
            <input
              autoFocus
              aria-label={`Filter ${columnLabel}`}
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
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-brand-ink hover:bg-brand-bg"
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
        </Popover.Content>
      </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

const detailCell = (label, value) => (
  <div className="min-w-0 [overflow-wrap:anywhere]">
    <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
    <p className="mt-0.5 text-sm font-medium text-brand-ink">{value === null || value === undefined || value === "" ? "—" : value}</p>
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
  const { user } = useAuth();
  const isBhw = String(user?.role || "").trim().toLowerCase() === "bhw";
  const { lastSyncedAt } = useSyncStatus();
  const { can, canAny } = usePermissions();
  const canCreateHousehold = can("households.create");
  const canManageMembers = can("households.create");
  const canRemoveMembers = canAny(["households.create", "households.verify"]);
  const canViewMemberHealth = can("residents.profile.view");

  const [households, setHouseholds] = useState([]);
  const [householdTotal, setHouseholdTotal] = useState(0);
  const [bhwListView, setBhwListView] = useState("all");
  const [zoneSummary, setZoneSummary] = useState(null);
  const [zoneSummaryError, setZoneSummaryError] = useState("");
  const [collapsedZones, setCollapsedZones] = useState(() => new Set());
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState(null);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  // BHWs get cards on mobile/tablet until they explicitly choose a view.
  const showTable = view ? view === "table" : !isBhw || wide;
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!isBhw) return;
    const params = new URLSearchParams(location.search);
    if (params.get("view") !== "returned") return;
    setPage(0);
    setBhwListView("returned");
    const householdId = params.get("household")?.trim();
    if (householdId) setSearch(householdId);
  }, [isBhw, location.search]);
  const [sort, setSort] = useState({ key: "id", dir: "asc" });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // Detail modal (household info + member management).
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [healthMember, setHealthMember] = useState(null);
  const [memberForm, setMemberForm] = useState({ name: "", relationship: "", sex: "", age: "", classification: "", isPwd: false });
  const [memberError, setMemberError] = useState(null);
  const [memberSaving, setMemberSaving] = useState(false);
  const [residentResults, setResidentResults] = useState([]);
  const [residentSearching, setResidentSearching] = useState(false);
  const [linkedResidentId, setLinkedResidentId] = useState(null);
  const memberSearchRef = useRef(null);
  const activeLoadRef = useRef(null);
  const loadSequenceRef = useRef(0);
  const searchChangePendingRef = useRef(false);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  };

  /** Load the household list from the API (search term applied server-side). */
  const load = useCallback(async (searchTerm = "", pageIndex = 0) => {
    const normalizedTerm = searchTerm.trim();
    if (!user?.id) {
      setLoading(false);
      return;
    }
    if (
      activeLoadRef.current?.ownerId === user.id &&
      activeLoadRef.current?.searchTerm === normalizedTerm &&
      activeLoadRef.current?.pageIndex === pageIndex &&
      activeLoadRef.current?.bhwListView === bhwListView
    ) {
      return activeLoadRef.current.promise;
    }

    const requestId = ++loadSequenceRef.current;
    setLoading(true);
    setLoadError(null);
    const promise = (async () => {
      try {
        const result = await listHouseholdsOffline({
          ownerId: user.id,
          params: {
            q: normalizedTerm,
            limit: HOUSEHOLD_PAGE_SIZE,
            offset: pageIndex * HOUSEHOLD_PAGE_SIZE,
            ...(isBhw && bhwListView === "returned" ? { verificationStatus: "Returned for Correction" } : {}),
          },
        });
        if (requestId !== loadSequenceRef.current) return;
        setHouseholds(result.rows);
        setHouseholdTotal(result.total);
        setLoadError(result.warning ? householdLoadErrorMessage(result.warning) : null);
      } catch (error) {
        if (requestId !== loadSequenceRef.current) return;
        setHouseholds([]);
        setHouseholdTotal(0);
        setLoadError(householdLoadErrorMessage(error));
      } finally {
        if (requestId === loadSequenceRef.current) {
          activeLoadRef.current = null;
          setLoading(false);
        }
      }
    })();
    activeLoadRef.current = {
      ownerId: user.id,
      searchTerm: normalizedTerm,
      pageIndex,
      bhwListView,
      promise,
    };
    return promise;
  }, [bhwListView, isBhw, user?.id]);

  useEffect(() => {
    setPage(0);
    load("", 0);
  }, [bhwListView, load]);

  useEffect(() => {
    if (user?.role !== "bhw") {
      setZoneSummary(null);
      return undefined;
    }
    let active = true;
    householdsApi.monitoringSummary()
      .then((summary) => {
        if (active) {
          setZoneSummary(summary);
          setZoneSummaryError("");
        }
      })
      .catch((error) => {
        if (active) setZoneSummaryError(error?.message || "Unable to load zone monitoring.");
      });
    return () => { active = false; };
  }, [user?.role, lastSyncedAt]);

  // A queued household can be confirmed while this page remains open. Reload
  // the authorized server list after that confirmation so the temporary local
  // row is replaced by the authoritative record without a browser refresh.
  useEffect(() => {
    if (lastSyncedAt) load(search.trim(), page);
    // `search` and `page` are intentionally read from the current render when
    // a sync completes; the separate search effect owns debounced search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSyncedAt, load]);

  // Debounced server-side search.
  const debounceRef = useRef(null);
  useEffect(() => {
    if (!searchChangePendingRef.current) return undefined;
    searchChangePendingRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      load(search.trim(), 0);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search, load]);

  // After the Add Household page saves, it returns here with a toast message.
  useEffect(() => {
    const message = location.state?.hhToast;
    if (!message) return undefined;
    setToast(message);
    const timer = setTimeout(() => setToast(null), Number(location.state?.hhToastDuration) || 3000);
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
      if (filters.risk.length && !filters.risk.includes(canonicalRiskLevel(h.riskLevel) || "Unassessed")) return false;
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
  const isReturnedList = isBhw && bhwListView === "returned";

  const visibleZoneGroups = useMemo(() => {
    if (user?.role !== "bhw") return [];
    const groups = new Map();
    visible.forEach((household) => {
      const name = household.purok || "Unassigned";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(household);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [user?.role, visible]);

  const monitoredHouseholds = useMemo(() => {
    const records = zoneSummary?.zones?.flatMap((zone) => zone.households || []) || [];
    return new Map(records.map((household) => [household.id, household]));
  }, [zoneSummary]);

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
    if (String(id).startsWith("LOCAL-")) {
      const local = households.find((row) => row.id === id);
      setDetail(local || null);
      setDetailLoading(false);
      return;
    }
    try {
      const household = await getHouseholdOffline({ ownerId: user?.id, householdId: id });
      setDetail(household || null);
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
    if (!canManageMembers) {
      showToast("You do not have permission to add household members.");
      return;
    }
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
      await load(search.trim(), page);
      showToast("Household member added.");
    } catch (err) {
      setMemberError(err?.message || "Could not add the household member.");
    } finally {
      setMemberSaving(false);
    }
  };

  const removeMember = async (member) => {
    if (!canRemoveMembers) {
      showToast("You do not have permission to remove household members.");
      return;
    }
    if (!detail) return;
    try {
      await householdsApi.removeMember(detail.id, member.id);
      const result = await householdsApi.get(detail.id);
      setDetail(result?.household || null);
      await load(search.trim(), page);
      showToast("Household member removed.");
    } catch (err) {
      showToast(err?.message || "Could not remove the household member.");
    }
  };

  const closeModal = () => {
    setDetailId(null);
    setDetail(null);
  };

  const editHousehold = () => {
    if (!detail || detail.localId) return;
    navigate(`${location.pathname.replace(/\/+$/, '')}/${detail.id}/edit`);
  };

  /* -------------------------------- render -------------------------------- */

  const renderRow = (h) => ({
    ...h,
    head: h.headName,
    collector: h.collectorName,
    approval: h.approvalStatus,
  });

  const renderHouseholdRow = (raw) => {
    const h = renderRow(raw);
    const monitoring = monitoredHouseholds.get(h.id);
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
        <td className={`px-4 py-3 font-medium text-brand-ink ${isBhw ? "min-w-40 max-w-60 [overflow-wrap:anywhere]" : "whitespace-nowrap"}`}>{h.head}</td>
        <td className="whitespace-nowrap px-4 py-3 text-brand-gray">{h.purok}</td>
        <td className="px-4 py-3 text-brand-gray">{h.streetAddress}</td>
        <td className="px-4 py-3"><HHBadge value={h.hhStatus} /></td>
        <td className={`px-4 py-3 text-brand-gray ${isBhw ? "max-w-60 [overflow-wrap:anywhere]" : "whitespace-nowrap"}`}>{h.collector || "—"}</td>
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
        <td className="px-4 py-3"><HHBadge value={h.approval} /></td>
        <td className="whitespace-nowrap px-4 py-3">
          <HHBadge risk value={h.riskLevel} />
        </td>
        {user?.role === "bhw" && (
          <td className="whitespace-nowrap px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-brand-gray">
                {monitoring?.latestVisitDate
                  ? `${Number(monitoring.latestVisitNumber) === 1 ? "Initial profile" : `Visit ${monitoring.latestVisitNumber}`} · ${formatVisitDate(monitoring.latestVisitDate)}`
                  : "No visit recorded"}
              </span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openDetail(h.id);
                }}
                className="min-h-11 font-medium text-brand-blue hover:underline"
              >
                View details
              </button>
            </div>
          </td>
        )}
      </tr>
    );
  };

  return (
    <>
      <PageHeader
        crumbs={["Household Profiling"]}
        title="Household Profiling"
        subtitle="Household conditions and risk classification across the barangay."
        action={canCreateHousehold ? (
          <button
            onClick={openAddPage}
            className="flex min-h-11 items-center gap-2 bg-brand-blue px-5 py-2.5 text-sm font-medium text-white rounded-btn transition-colors hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> Add Household
          </button>
        ) : null}
      />

      {/* Toast Notification */}
      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100%-2rem)] animate-in slide-in-from-bottom-2 items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          <RefreshCw className="h-4 w-4 text-brand-green" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}

      {/* Search / view toolbar */}
      <Card className="mb-5 p-4">
        {isBhw && <div role="tablist" aria-label="Household verification lists" className="mb-4 flex w-full gap-1 overflow-x-auto border-b border-brand-border">
          {[{ id: "all", label: "All Households" }, { id: "returned", label: "Returned Households" }].map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={bhwListView === tab.id}
              onClick={() => { if (bhwListView === tab.id) return; setPage(0); setSearch(""); setBhwListView(tab.id); }}
              className={`min-h-11 shrink-0 border-b-2 px-4 text-sm font-medium ${bhwListView === tab.id ? "border-brand-blue text-brand-blue" : "border-transparent text-brand-gray hover:text-brand-ink"}`}>
              {tab.label}
            </button>
          ))}
        </div>}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex w-full items-center gap-2 rounded-input border border-brand-border bg-brand-bg px-3 py-2.5 md:max-w-sm">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              type="search"
              aria-label="Search households"
              value={search}
              onChange={(e) => {
                searchChangePendingRef.current = true;
                setPage(0);
                setSearch(e.target.value);
              }}
              placeholder="Search households, heads, collectors..."
              className="w-full min-w-0 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/50"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-brand-gray">
              {visible.length} of {households.length} households
              {householdTotal > households.length && ` · ${householdTotal} total`}
              {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} active`}
            </span>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  searchChangePendingRef.current = Boolean(search);
                  setFilters(EMPTY_FILTERS);
                  setSearch("");
                }}
                className="min-h-11 text-sm font-medium text-brand-blue hover:underline"
              >
                Clear all
              </button>
            )}
            <div role="group" aria-label="Household view" className="flex overflow-hidden rounded-btn border border-brand-border">
                  <button type="button" aria-pressed={showTable} onClick={() => setView("table")} className={`flex min-h-11 items-center gap-1.5 px-3 text-xs font-medium ${showTable ? "bg-brand-blue text-white" : "bg-white text-brand-gray hover:bg-brand-bg"}`}>
                    <Table2 className="h-3.5 w-3.5" /> Table
                  </button>
                  <button type="button" aria-pressed={!showTable} onClick={() => setView("cards")} className={`flex min-h-11 items-center gap-1.5 px-3 text-xs font-medium ${!showTable ? "bg-brand-blue text-white" : "bg-white text-brand-gray hover:bg-brand-bg"}`}>
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
            onRetry={() => load(search.trim(), page)}
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
            title={isBhw && bhwListView === "returned" ? "No returned households" : "No households yet"}
            description={isBhw && bhwListView === "returned" ? "Households returned by the Health Supervisor for correction will appear here." : "Household records will appear here once they are registered."}
            action={canCreateHousehold && !(isBhw && bhwListView === "returned") ? (
              <button
                onClick={openAddPage}
                className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                <Plus className="h-4 w-4" /> Add Household
              </button>
            ) : null}
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
                  searchChangePendingRef.current = Boolean(search);
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

      {!loadError && !loading && isReturnedList && visible.length > 0 && (
        <>
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg text-left text-xs uppercase tracking-wide text-brand-gray">
                  {["Household ID", "Household Head", "Zone / Purok", "Date Submitted", "Date Returned", "Returned By", "Reason for Return", "Verification Status", "Action"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {visible.map((household) => (
                  <tr key={household.id} className="align-top hover:bg-brand-bg/50">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-brand-ink">{household.id}</td>
                    <td className="px-4 py-3 font-medium text-brand-ink">{household.headName || "—"}</td>
                    <td className="px-4 py-3 text-brand-gray">{household.purok || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-brand-gray">{formatWorkflowDate(household.submittedAt || household.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-brand-gray">{formatWorkflowDate(household.verifiedAt)}</td>
                    <td className="px-4 py-3 text-brand-gray">{household.returnedByName || household.verifiedBy || "—"}</td>
                    <td className="max-w-64 px-4 py-3 text-brand-gray [overflow-wrap:anywhere]">{household.correctionReason || "No return reason recorded."}</td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${VERIFICATION_TONES[household.verificationStatus] || VERIFICATION_TONES["Pending Verification"]}`}>{household.verificationStatus || "Pending Verification"}</span></td>
                    <td className="px-4 py-3"><button type="button" onClick={() => navigate(`${location.pathname.replace(/\/+$/, "")}/${household.id}/edit`)} className="min-h-11 whitespace-nowrap font-medium text-brand-blue hover:underline">Edit / Correct</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="space-y-3 md:hidden">
            {visible.map((household) => (
              <Card key={household.id} className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-brand-gray">{household.id}</p>
                    <h2 className="mt-0.5 break-words text-base font-semibold text-brand-ink">{household.headName || "Household head not recorded"}</h2>
                    <p className="mt-1 text-sm text-brand-gray">{household.purok || "Zone not recorded"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${VERIFICATION_TONES[household.verificationStatus] || VERIFICATION_TONES["Pending Verification"]}`}>{household.verificationStatus || "Pending Verification"}</span>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-brand-border pt-3 text-sm">
                  {[["Date submitted", formatWorkflowDate(household.submittedAt || household.createdAt)], ["Date returned", formatWorkflowDate(household.verifiedAt)], ["Returned by", household.returnedByName || household.verifiedBy || "—"]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-brand-gray">{label}</dt><dd className="mt-0.5 break-words font-medium text-brand-ink">{value}</dd></div>)}
                  <div className="col-span-2 min-w-0"><dt className="text-xs text-brand-gray">Reason for return</dt><dd className="mt-0.5 break-words text-brand-ink">{household.correctionReason || "No return reason recorded."}</dd></div>
                </dl>
                <button type="button" onClick={() => navigate(`${location.pathname.replace(/\/+$/, "")}/${household.id}/edit`)} className="min-h-11 w-full rounded-btn bg-brand-blue px-4 text-sm font-medium text-white hover:bg-brand-dark">Edit / Correct household</button>
              </Card>
            ))}
          </div>
        </>
      )}

      {!loading && !isReturnedList && visible.length > 0 && showTable && (
        <Card className="min-w-0">
          {user?.role === "bhw" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border bg-brand-bg/60 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-brand-ink">Zone / Purok Monitoring</h2>
                {zoneSummaryError ? (
                  <p className="mt-0.5 text-xs text-rose-600">{zoneSummaryError}</p>
                ) : zoneSummary ? (
                  <p className="mt-0.5 text-xs text-brand-gray">
                    {zoneSummary.totalHouseholds} households · {zoneSummary.visitedHouseholds} visited · {zoneSummary.householdsWithoutVisits} without a visit
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-brand-gray">Loading visit counts…</p>
                )}
              </div>
              <span className="text-xs text-brand-gray">Expand a Purok row to view its households</span>
            </div>
          )}
          <div className="overflow-x-auto" role="region" aria-label="Households table" tabIndex={isBhw ? 0 : undefined}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg text-left">
                  {[...COLUMNS, ...(user?.role === "bhw" ? [{ key: "visitMonitoring", label: "Visit Monitoring" }] : [])].map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap px-4 py-3 text-xs font-medium uppercase text-brand-gray"
                    >
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => toggleSort(c.key)}
                          className="flex min-h-11 items-center gap-1 transition-colors hover:text-brand-ink"
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
                            options={c.key === "purok" && zoneSummary?.zones?.length
                              ? zoneSummary.zones.map((zone) => zone.purok)
                              : c.options}
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
                {(user?.role === "bhw"
                  ? visibleZoneGroups.flatMap(([zoneName, rows]) => {
                    const summary = zoneSummary?.zones?.find((zone) => zone.purok === zoneName);
                    const collapsed = collapsedZones.has(zoneName);
                    return [
                      <tr key={`zone-${zoneName}`} className="border-b border-brand-border bg-brand-bg/70">
                        <td colSpan={COLUMNS.length + (user?.role === "bhw" ? 1 : 0)} className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setCollapsedZones((previous) => {
                              const next = new Set(previous);
                              if (next.has(zoneName)) next.delete(zoneName);
                              else next.add(zoneName);
                              return next;
                            })}
                            aria-expanded={!collapsed}
                            className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                          >
                            <span className="flex items-center gap-2 font-semibold text-brand-ink">
                              <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                              {zoneName}
                              <span className="font-normal text-brand-gray">{rows.length} shown</span>
                            </span>
                            <span className="text-xs text-brand-gray">
                              {summary ? `${summary.total} total · ${summary.visited} visited · ${summary.notVisited} no visits` : "Visit totals unavailable"}
                            </span>
                          </button>
                        </td>
                      </tr>,
                      ...(!collapsed ? rows.map((raw) => renderHouseholdRow(raw)) : []),
                    ];
                  })
                  : visible.map((raw) => renderHouseholdRow(raw)))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && !isReturnedList && visible.length > 0 && !showTable && (
        <div className="space-y-6">
          {user?.role === "bhw" && (
            <Card className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <h2 className="text-sm font-semibold text-brand-ink">Zone / Purok Monitoring</h2>
              {zoneSummary ? (
                <p className="text-xs text-brand-gray">
                  {zoneSummary.totalHouseholds} households · {zoneSummary.visitedHouseholds} visited · {zoneSummary.householdsWithoutVisits} without a visit
                </p>
              ) : (
                <p className="text-xs text-brand-gray">{zoneSummaryError || "Loading visit counts…"}</p>
              )}
            </Card>
          )}
          {(user?.role === "bhw" ? visibleZoneGroups : [[null, visible]]).map(([zoneName, rows]) => {
            const summary = zoneName && zoneSummary?.zones?.find((zone) => zone.purok === zoneName);
            return (
              <section key={zoneName || "all-households"}>
                {user?.role === "bhw" && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="min-w-0 text-base font-semibold text-brand-ink [overflow-wrap:anywhere]">{zoneName}</h2>
                    <p className="text-xs text-brand-gray">
                      {summary ? `${summary.total} total · ${summary.visited} visited · ${summary.notVisited} no visits` : `${rows.length} households shown`}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {rows.map((raw, i) => {
                    const h = renderRow(raw);
                    const monitoring = monitoredHouseholds.get(h.id);
                    return (
                      <motion.div
                        key={h.id}
                        className="min-w-0"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06 }}
                      >
                <Card className="h-full p-4 [overflow-wrap:anywhere] sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 basis-full xl:basis-0 xl:flex-1">
                      <p className="text-xs text-brand-gray">{h.id}</p>
                      <h3 className="mt-0.5 font-semibold text-brand-ink">{h.head}</h3>
                      <p className="mt-0.5 text-xs text-brand-gray">
                        {h.purok} · {h.streetAddress}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-start gap-2 xl:flex-col xl:items-end">
                      <HHBadge risk value={h.riskLevel} />
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
                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm [&_svg]:shrink-0">
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Users className="h-4 w-4 text-brand-blue" /> {h.memberCount ?? 0} members
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Layers className="h-4 w-4 text-brand-blue" /> {h.families || 1} famil{(h.families || 1) === 1 ? "y" : "ies"}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Wallet className="h-4 w-4 text-brand-blue" />{" "}
                      {h.monthlyIncome !== null && h.monthlyIncome !== undefined && h.monthlyIncome !== "" ? `₱${Number(h.monthlyIncome).toLocaleString()}/mo` : "—"}
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
                    {user?.role === "bhw" && (
                      <p className="col-span-2 flex items-center gap-2 text-brand-gray">
                        <ClipboardList className="h-4 w-4 shrink-0 text-brand-blue" />
                        {monitoring?.latestVisitDate
                          ? `${Number(monitoring.latestVisitNumber) === 1 ? "Initial profile" : `Visit ${monitoring.latestVisitNumber}`} · ${formatVisitDate(monitoring.latestVisitDate)}`
                          : "No visit recorded"}
                      </p>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(h.flags || []).map((c) => (
                      <span key={c} className="rounded-full bg-brand-light px-2.5 py-1 text-xs text-brand-blue">
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                  <button
                    onClick={() => openDetail(h.id)}
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                  >
                    <Eye className="h-4 w-4" /> View details
                  </button>
                  {user?.role === "bhw" && !String(h.id).startsWith("LOCAL-") && (
                    <button
                      type="button"
                      onClick={() => navigate(`${location.pathname.replace(/\/+$/, "")}/${h.id}`)}
                      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                    >
                      <ClipboardList className="h-4 w-4" /> Visit history
                    </button>
                  )}
                  </div>
                </Card>
              </motion.div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!loading && householdTotal > HOUSEHOLD_PAGE_SIZE && (
        <TablePagination
          total={householdTotal}
          page={page + 1}
          pageSize={HOUSEHOLD_PAGE_SIZE}
          onPageChange={(nextPage) => {
            const nextOffsetPage = nextPage - 1;
            setPage(nextOffsetPage);
            load(search.trim(), nextOffsetPage);
          }}
          showPageSize={false}
          itemLabel="households"
          className="mt-5"
        />
      )}

      {/* Household detail modal — info + member management */}
      {detailId && (
        <HouseholdDialog label="Household details" onClose={closeModal}>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-border bg-white px-4 py-3 dark:bg-card sm:px-6">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-brand-ink">Household details</h2>
                {detail && <p className="mt-0.5 break-all text-xs text-brand-gray">{detail.id}</p>}
              </div>
              {detail && (
                <div className="flex flex-wrap items-center gap-2">
                  <HHBadge risk value={detail.riskLevel} />
                  <HHBadge value={detail.hhStatus} />
                </div>
              )}
              <button type="button" onClick={closeModal} className="grid h-11 w-11 shrink-0 place-items-center rounded-btn text-brand-gray hover:bg-brand-bg" aria-label="Close household details">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere] sm:p-6">
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
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                      <p className="text-xs text-brand-gray">{detail.id}</p>
                      <h3 className="text-lg font-semibold text-brand-ink">{detail.headName}</h3>
                      <p className="mt-0.5 text-xs text-brand-gray">
                        {detail.purok} · {detail.streetAddress} · Brgy. {detail.barangay}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end">
                      {canAny(["households.create", "households.verify"]) && !detail.localId && (
                        <button
                          type="button"
                          onClick={editHousehold}
                          className="min-h-11 text-sm font-medium text-brand-blue hover:underline"
                        >
                          Edit household profile
                        </button>
                      )}
                      {user?.role === "bhw" && !detail.localId && (
                        <button
                          type="button"
                          onClick={() => navigate(`${location.pathname.replace(/\/+$/, "")}/${detail.id}`)}
                          className="min-h-11 text-sm font-medium text-brand-blue hover:underline"
                        >
                          Visit history &amp; full profile
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 sm:p-5">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                      Household Information
                    </p>
                    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                      {detailCell("Members", detail.members?.length ?? 0)}
                      {detailCell("Families", detail.families)}
                      {detailCell("Monthly Income", detail.monthlyIncome !== null && detail.monthlyIncome !== undefined && detail.monthlyIncome !== "" ? `₱${Number(detail.monthlyIncome).toLocaleString()}` : "—")}
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

                  <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                        Household Members ({detail.members?.length ?? 0})
                      </p>
                      {canManageMembers && (
                        <button
                          onClick={() => {
                            setShowAddMember((v) => !v);
                            setMemberError(null);
                          }}
                          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                        >
                          <UserPlus className="h-4 w-4" /> Add member
                        </button>
                      )}
                    </div>

                    {showAddMember && (
                      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                        <div ref={memberSearchRef} className="relative grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <label htmlFor="household-detail-member" className="text-sm font-medium text-brand-ink">
                              Resident (search to link an existing record)
                            </label>
                            <input
                              id="household-detail-member"
                              value={memberForm.name}
                              onChange={(e) => searchResidents(e.target.value)}
                              placeholder="Search residents by name…"
                              className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
                            />
                            {residentSearching && (
                              <p className="mt-1 text-xs text-brand-gray">Searching…</p>
                            )}
                            {residentResults.length > 0 && (
                              <div className="mt-1 max-h-48 overflow-y-auto rounded-btn border border-brand-border bg-white">
                                {residentResults.map((r) => (
                                  <button
                                    key={r.id}
                                    onClick={() => pickResident(r)}
                                    className="block min-h-11 w-full px-3.5 py-2.5 text-left text-sm hover:bg-brand-bg"
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
                            <ButtonSelectGroup
                              ariaLabel="Sex"
                              variant="compact"
                              options={["Male", "Female"]}
                              value={memberForm.sex}
                              onChange={(v) => setMemberForm((p) => ({ ...p, sex: v }))}
                            />
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
                          <div className="flex flex-wrap justify-end gap-2 sm:col-span-2 [&>button]:min-h-11">
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
                          <div key={m.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                            <div className="min-w-0 flex-1 basis-48">
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
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 [&>button]:min-h-11">
                              <AccountBadge status={m.accountStatus} />
                              {canViewMemberHealth && (
                                <button
                                  onClick={() => setHealthMember(m)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue transition-colors hover:underline"
                                  aria-label={`Health profile for ${m.name}`}
                                >
                                  <HeartPulse className="h-3.5 w-3.5" /> Health
                                </button>
                              )}
                              {canRemoveMembers && (
                                <button
                                  onClick={() => removeMember(m)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-gray transition-colors hover:text-brand-danger"
                                  aria-label={`Remove ${m.name}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Remove
                                </button>
                              )}
                            </div>
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
        </HouseholdDialog>
      )}

      {/* Member Health Profile — opened per household member from the detail modal */}
      {healthMember && detail && (
        <MemberHealthModal
          householdId={detail.id}
          member={healthMember}
          verificationStatus={detail.verificationStatus}
          currentRole={user?.role}
          onClose={() => setHealthMember(null)}
        />
      )}
    </>
  );
}
