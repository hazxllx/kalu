import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import {
  Users,
  Droplet,
  Home,
  Wallet,
  Layers,
  Plus,
  RefreshCw,
  Cloud,
  CloudOff,
  Search,
  Filter,
  LayoutGrid,
  Table2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ClipboardList,
} from "lucide-react";
import { households as initialHouseholds, systemUsers } from "@/services/mock/mockData";
import { useAuth } from "@/context/AuthContext";
import HHBadge from "../components/HHBadge";
import AddHouseholdModal from "../components/AddHouseholdModal";
import {
  HH_STATUSES,
  APPROVAL_STATUSES,
  PUROKS,
  BHW_NAMES,
  riskFromScore,
  nextHouseholdId,
} from "../lib/householdOptions";

const ACTIVE_BHWS = systemUsers.filter((u) => u.role === "BHW" && u.status === "Active").map((u) => u.name);

const COLUMNS = [
  { key: "id", label: "Household ID", filter: "text", placeholder: "Filter ID..." },
  { key: "head", label: "Household Head", filter: "text", placeholder: "Filter name..." },
  { key: "purok", label: "Purok/Zone", filter: "list", options: PUROKS },
  { key: "streetAddress", label: "Street Address / Sitio", filter: "text", placeholder: "Filter address..." },
  { key: "hhStatus", label: "HH Status", filter: "list", options: HH_STATUSES },
  { key: "collector", label: "Assigned Data Collector", filter: "list", options: BHW_NAMES },
  { key: "approval", label: "Approval Status", filter: "list", options: APPROVAL_STATUSES },
  { key: "risk", label: "Risk Level", filter: "list", options: ["Low", "Moderate", "High"] },
];

const EMPTY_FILTERS = {
  id: "",
  head: "",
  purok: [],
  streetAddress: "",
  hhStatus: [],
  collector: [],
  approval: [],
  risk: [],
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

export default function Households() {
  const { user } = useAuth();
  const [syncStatus, setSyncStatus] = useState("offline");
  const [householdList, setHouseholdList] = useState(initialHouseholds);
  const [toast, setToast] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [view, setView] = useState("table");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "id", dir: "asc" });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const defaultCollector =
    user?.role === "bhw" && user?.name ? user.name : ACTIVE_BHWS[0] || "Maria Cruz";
  const bhwOptions = bhwOptionsFor(defaultCollector);
  const nextId = nextHouseholdId(householdList);

  const handleSync = () => {
    setSyncStatus("syncing");
    setTimeout(() => {
      setSyncStatus("connected");
      setHouseholdList((prev) => prev.map((h) => ({ ...h, syncStatus: null })));
      setToast("Synchronization Complete - All pending records have been uploaded successfully.");
      setTimeout(() => setToast(null), 3000);
    }, 2000);
  };

  const handleSaveHousehold = (hh) => {
    const tagged = syncStatus === "offline" ? { ...hh, syncStatus: "Pending Sync" } : hh;
    setHouseholdList((prev) => [tagged, ...prev]);
    setModalOpen(false);
    setToast(`Household ${hh.id} added successfully`);
    setTimeout(() => setToast(null), 3000);
  };

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const toggleSort = (key) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = householdList.filter((h) => {
      const risk = riskFromScore(h.riskScore);
      if (q) {
        const haystack = [h.id, h.head, h.address, h.purok, h.collector].map((v) =>
          String(v || "").toLowerCase()
        );
        if (!haystack.some((v) => v.includes(q))) return false;
      }
      if (filters.id && !String(h.id || "").toLowerCase().includes(filters.id.toLowerCase())) return false;
      if (filters.head && !String(h.head || "").toLowerCase().includes(filters.head.toLowerCase())) return false;
      if (filters.streetAddress && !String(h.streetAddress || "").toLowerCase().includes(filters.streetAddress.toLowerCase()))
        return false;
      if (filters.purok.length && !filters.purok.includes(h.purok)) return false;
      if (filters.hhStatus.length && !filters.hhStatus.includes(h.hhStatus)) return false;
      if (filters.collector.length && !filters.collector.includes(h.collector)) return false;
      if (filters.approval.length && !filters.approval.includes(h.approval)) return false;
      if (filters.risk.length && !filters.risk.includes(risk)) return false;
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
  }, [householdList, search, filters, sort]);

  const activeFilterCount =
    COLUMNS.reduce(
      (acc, c) => acc + (c.filter === "text" ? (filters[c.key] ? 1 : 0) : filters[c.key].length),
      0
    ) + (search ? 1 : 0);

  return (
    <>
      <PageHeader
        crumbs={["Home", "Household Profiling"]}
        title="Household Profiling"
        subtitle="Household conditions and risk classification across the barangay."
        action={
          <button
            onClick={() => setModalOpen(true)}
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

      {/* Synchronization Status */}
      <Card className="mb-5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {syncStatus === "offline" && (
              <>
                <CloudOff className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Offline Mode</p>
                  <p className="text-xs text-brand-gray">
                    {householdList.filter((h) => h.syncStatus === "Pending Sync").length} households
                    waiting to sync
                  </p>
                </div>
              </>
            )}
            {syncStatus === "syncing" && (
              <>
                <RefreshCw className="h-5 w-5 animate-spin text-brand-blue" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Syncing...</p>
                  <p className="text-xs text-brand-gray">Uploading household profiles...</p>
                </div>
              </>
            )}
            {syncStatus === "connected" && (
              <>
                <Cloud className="h-5 w-5 text-brand-green" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Connected</p>
                  <p className="text-xs text-brand-gray">All households synchronized</p>
                </div>
              </>
            )}
          </div>
          {syncStatus === "offline" &&
            householdList.filter((h) => h.syncStatus === "Pending Sync").length > 0 && (
              <button
                onClick={handleSync}
                className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                <RefreshCw className="h-4 w-4" /> Sync Now
              </button>
            )}
        </div>
      </Card>

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
              {visible.length} of {householdList.length} households
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

      {/* Household list */}
      {view === "table" ? (
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
                {visible.map((h) => {
                  const risk = riskFromScore(h.riskScore);
                  return (
                    <tr
                      key={h.id}
                      className="border-b border-brand-border transition-colors last:border-0 hover:bg-brand-bg/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-brand-ink">{h.id}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-brand-ink">{h.head}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-brand-gray">{h.purok}</td>
                      <td className="px-4 py-3 text-brand-gray">{h.streetAddress}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          <HHBadge value={h.hhStatus} />
                          {h.syncStatus && <StatusBadge value={h.syncStatus} />}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-brand-gray">{h.collector}</td>
                      <td className="px-4 py-3">
                        <HHBadge value={h.approval} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <HHBadge value={risk} label={`${risk} Risk`} />
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-5 py-10 text-center text-sm text-brand-gray">
                      No households match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {visible.map((h, i) => {
            const risk = riskFromScore(h.riskScore);
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
                      <HHBadge value={risk} label={`${risk} Risk`} />
                      <HHBadge value={h.hhStatus} />
                      {h.syncStatus && <StatusBadge value={h.syncStatus} />}
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Users className="h-4 w-4 text-brand-blue" /> {h.members} members
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Layers className="h-4 w-4 text-brand-blue" /> {h.families || 1}{" "}
                      famil{(h.families || 1) === 1 ? "y" : "ies"}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Wallet className="h-4 w-4 text-brand-blue" /> {h.income}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Droplet className="h-4 w-4 text-brand-blue" /> {h.water}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <Home className="h-4 w-4 text-brand-blue" /> {h.toilet}
                    </p>
                    <p className="flex items-center gap-2 text-brand-gray">
                      <ClipboardList className="h-4 w-4 text-brand-blue" /> {h.collector}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(h.concerns || []).map((c) => (
                      <span key={c} className="rounded-full bg-brand-light px-2.5 py-1 text-xs text-brand-blue">
                        {c}
                      </span>
                    ))}
                  </div>
                </Card>
              </motion.div>
            );
          })}
          {visible.length === 0 && (
            <Card className="p-10 text-center text-sm text-brand-gray md:col-span-2">
              No households match the selected filters.
            </Card>
          )}
        </div>
      )}

      {/* Add New Household slide-over */}
      <AnimatePresence>
        {modalOpen && (
          <AddHouseholdModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onSave={handleSaveHousehold}
            householdId={nextId}
            bhwOptions={bhwOptions}
            defaultCollector={defaultCollector}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function bhwOptionsFor(defaultCollector) {
  const base = ACTIVE_BHWS.length > 0 ? ACTIVE_BHWS : BHW_NAMES;
  return defaultCollector && !base.includes(defaultCollector)
    ? [defaultCollector, ...base]
    : base;
}
