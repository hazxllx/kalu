import React, { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/tables/DataTable";
import { Card } from "@/components/common/Card";
import { Plus, X, Search, CheckCircle2, RefreshCw, Pencil, Download, Loader2 } from "lucide-react";
import { residentsApi, householdsApi, programFormsApi } from "@/services/api";
import ProgramFormModal from "./ProgramFormModal";
import { fromRow } from "../lib/programFormConfig";
import { buildProgramCsv, downloadCsv } from "../lib/programFormExport";

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const residentName = (r) =>
  [r.first_name || r.firstName, r.middle_name || r.middleName, r.last_name || r.lastName]
    .filter(Boolean).join(" ").trim() || r.name || "Unknown";

const normalizeResident = (r) => ({
  id: r.id,
  name: residentName(r),
  barangay: r.barangay || "",
  age: r.age ?? "",
});

const householdName = (h) => `${h.head_name || h.headName || "Household"}${h.purok ? ` · Purok ${h.purok}` : ""}`;
const normalizeHousehold = (h) => ({ id: h.id, name: householdName(h), barangay: h.barangay || "" });

/** Resolve the entity (resident/household) summary from an embedded row. */
const entityFromRow = (config, row) => {
  if (config.scope === "household") {
    const h = row.household || {};
    return { id: row.household_id, name: householdName(h), barangay: h.barangay || "" };
  }
  const r = row.resident || {};
  return { id: row.resident_id, name: residentName(r), barangay: r.barangay || "" };
};

const cellValue = (col, row) => {
  if (col.render) return col.render(row[col.key], row);
  if (col.path) {
    const v = col.path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), row);
    return col.kind === "date" ? formatDate(v) : (v ?? "—");
  }
  if (col.kind === "date") return formatDate(row[col.key]);
  if (col.kind === "bool") return row[col.key] === true ? "Yes" : row[col.key] === false ? "No" : "—";
  const v = row[col.key];
  return v == null || v === "" ? "—" : v;
};

/**
 * Generic list + create/edit page for one program-specific TCL / health form.
 * Reused by the NCD, Oral Health and Environmental Masterlist screens. All data
 * is persisted through the real /program-forms API (no local-only state).
 */
export default function ProgramFormPage({ config }) {
  const api = programFormsApi[config.kind];
  const [rows, setRows] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);

  const [picking, setPicking] = useState(false);       // entity picker open
  const [query, setQuery] = useState("");
  const [recordQuery, setRecordQuery] = useState("");  // records table filter
  const [editing, setEditing] = useState(null);        // { entity, initialForm, id? }
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const entityLoad = config.scope === "household"
      ? householdsApi.list().then((r) => (r?.rows || r || []).map(normalizeHousehold))
      : residentsApi.list({ limit: 300 }).then((r) => (r?.rows || r || []).map(normalizeResident));
    return Promise.all([api.list(), entityLoad])
      .then(([recordResult, entityRows]) => {
        setRows(recordResult?.rows || []);
        setEntities(entityRows);
      })
      .catch((err) => { setLoadError(err?.message || "Unable to load records."); setRows([]); })
      .finally(() => setLoading(false));
  }, [api, config.scope]);

  useEffect(() => { load(); }, [load]);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const filteredEntities = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entities.slice(0, 12);
    return entities.filter((e) => e.name.toLowerCase().includes(q) || String(e.id).toLowerCase().includes(q)).slice(0, 12);
  }, [entities, query]);

  // Client-side filter over the loaded records (by client/household name).
  const visibleRows = useMemo(() => {
    const q = recordQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const name = config.scope === "household"
        ? householdName(row.household || {})
        : (row.resident ? residentName(row.resident) : "");
      return name.toLowerCase().includes(q);
    });
  }, [rows, recordQuery, config.scope]);

  const openCreate = (entity) => {
    setPicking(false);
    setQuery("");
    setSubmitError("");
    setEditing({ entity, initialForm: fromRow(config, {}), id: null });
  };

  const openEdit = (row) => {
    setSubmitError("");
    setEditing({ entity: entityFromRow(config, row), initialForm: fromRow(config, row), id: row.id });
  };

  const save = async (record) => {
    setSaving(true);
    setSubmitError("");
    try {
      if (editing.id) {
        const res = await api.update(editing.id, record);
        setRows((cur) => cur.map((r) => (r.id === editing.id ? res.record : r)));
        showToast("Record updated.");
      } else {
        const res = await api.create(record);
        setRows((cur) => [res.record, ...cur]);
        showToast("Record saved.");
      }
      setEditing(null);
    } catch (err) {
      setSubmitError(err?.message || "Could not save the record.");
    } finally {
      setSaving(false);
    }
  };

  const columns = [...config.columns, { key: "__actions", label: "" }];

  return (
    <>
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-brand-green" /><span className="text-sm">{toast}</span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex h-10 min-w-[12rem] flex-1 items-center gap-2 rounded-btn border border-brand-border bg-white px-3 focus-within:border-brand-blue">
          <Search className="h-4 w-4 shrink-0 text-brand-gray" />
          <input value={recordQuery} onChange={(e) => setRecordQuery(e.target.value)} placeholder="Search records" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <button
          onClick={() => {
            if (!rows.length) { showToast("No records to export."); return; }
            downloadCsv(`${config.kind}-${new Date().toISOString().slice(0, 10)}.csv`, buildProgramCsv(config.kind, rows));
          }}
          className="inline-flex items-center gap-2 rounded-btn border border-brand-border px-3 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
        <button onClick={() => { setPicking(true); setQuery(""); }} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
          <Plus className="h-4 w-4" /> New Record
        </button>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-center">
          <Loader2 className="h-4 w-4 animate-spin text-brand-blue" />
          <span className="text-sm text-brand-gray">Loading records…</span>
        </Card>
      ) : loadError ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-brand-ink">We couldn't load these records.</p>
          <p className="mt-1 text-sm text-brand-gray">There was a problem reaching the server. Your data is safe — please try again.</p>
          <button onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
          <details className="mx-auto mt-4 max-w-md text-left">
            <summary className="cursor-pointer text-xs text-brand-gray">Technical details (for developers)</summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-600">{String(loadError)}</pre>
          </details>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-brand-ink">No records yet</p>
          <button onClick={() => { setPicking(true); setQuery(""); }} className="mt-3 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
            <Plus className="h-4 w-4" /> New Record
          </button>
        </Card>
      ) : visibleRows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-brand-gray">No records match “{recordQuery}”.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <DataTable
            columns={columns}
            rows={visibleRows}
            renderCell={(key, row) => {
              if (key === "__actions") {
                return (
                  <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 text-brand-blue text-sm font-medium hover:underline">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                );
              }
              if (key === "resident") return <span className="font-medium text-brand-ink">{row.resident ? residentName(row.resident) : "—"}</span>;
              if (key === "household") return <span className="font-medium text-brand-ink">{row.household ? householdName(row.household) : "—"}</span>;
              const col = config.columns.find((c) => c.key === key);
              return <span className="text-brand-ink">{col ? cellValue(col, row) : (row[key] ?? "—")}</span>;
            }}
          />
        </div>
      )}

      {/* Entity picker */}
      {picking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-lg font-semibold text-brand-ink">Select {config.scope === "household" ? "household" : "client"}</h3>
                <button onClick={() => setPicking(false)} className="text-brand-gray hover:text-brand-ink"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex items-center gap-2 bg-white border border-brand-border rounded-btn px-3 py-2.5 focus-within:border-brand-blue">
                <Search className="w-4 h-4 shrink-0 text-brand-gray" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder={`Search ${config.scope === "household" ? "household head" : "resident"} by name or ID…`} className="w-full bg-transparent text-sm outline-none" />
              </div>
              <div className="mt-3 max-h-80 overflow-y-auto rounded-btn border border-brand-border divide-y divide-brand-border">
                {filteredEntities.map((e) => (
                  <button key={e.id} onClick={() => openCreate(e)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-brand-light transition-colors">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-brand-ink">{e.name}</span>
                      <span className="block text-xs text-brand-gray">{[e.id, e.barangay, e.age ? `${e.age} yrs` : null].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                ))}
                {filteredEntities.length === 0 && <p className="px-3 py-3 text-sm text-brand-gray">No matches.</p>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {editing && (
        <ProgramFormModal
          config={config}
          entity={editing.entity}
          initialForm={editing.initialForm}
          saving={saving}
          submitError={submitError}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </>
  );
}
