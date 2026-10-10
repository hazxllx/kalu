import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card } from "@/components/common/Card";
import { ArrowRight, FileSpreadsheet, Search, Clock, ChevronRight } from "lucide-react";
import { programFormsApi, maternalApi, tclApi } from "@/services/api";

/**
 * Target Client List workspace — the single entry point reached from
 * Records → TCL. It lists every available official TCL grouped by health
 * program, with a short description, a real record count (when it loads) and an
 * "Open TCL" action into the actual working form. Source-dependent forms with
 * no official workbook yet are shown as awaiting their reference file.
 */

// countKey: how to fetch a real record count (null = no count shown).
const GROUPS = [
  {
    title: "Maternal and Family Health",
    items: [
      { id: "maternal", name: "Prenatal and Postpartum", to: "../m1?from=tcl", countKey: "maternal", status: "available", requiresRole: "health_supervisor",
        desc: "Pregnant and postpartum mothers — LMP/EDC, prenatal check-ups, immunization, laboratory screening, delivery and postpartum care." },
      { id: "family-planning", name: "Family Planning", status: "unavailable",
        desc: "Family planning clients, method and follow-up visits.", blocked: "Awaiting the official Family Planning TCL workbook (pp-055-056-FP-TCL)." },
      { id: "child-care", name: "Child Care", status: "unavailable",
        desc: "Child-health target client lists (0–11 mos, under-5, 5–9, 10–19, sick child).", blocked: "Awaiting the official Child Care TCL workbook (CC-TCL-FHO)." },
    ],
  },
  {
    title: "Screening and Preventive Care",
    items: [
      { id: "ncd-risk", name: "NCD Risk Assessment", to: "../ncd?tab=ncd-risk", countKey: "ncd-risk", status: "available",
        desc: "Adults 20 y/o and above — smoking, alcohol, overweight/obesity, hypertension and diabetes screening (Part 1)." },
      { id: "ncd-cervical", name: "Cervical Cancer and Breast Mass Examination", to: "../ncd?tab=ncd-cervical", countKey: "ncd-cervical", status: "available",
        desc: "VIA / Pap smear results, risk status, and suspicious breast-mass findings (Part 2)." },
      { id: "ncd-visual", name: "Visual Acuity and PPV", to: "../ncd?tab=ncd-visual", countKey: "ncd-visual", status: "available",
        desc: "Senior citizens — eye complaints, visual acuity, pinhole, referral management and PPV immunization (Part 3)." },
      { id: "oral-health", name: "Oral Health", to: "../oral-health", countKey: "oral-health", status: "available",
        desc: "Individual oral-health client records and services, plus the separate BOHC statistical table." },
    ],
  },
  {
    title: "Environmental Health",
    items: [
      { id: "environmental", name: "Household Environmental Masterlist", to: "../environmental", countKey: "environmental", status: "available",
        desc: "Per-household water supply, sanitation facilities, waste management and complete-sanitation indicators (Parts 1–4)." },
    ],
  },
  {
    title: "Community Health Programs",
    items: [
      { id: "enrollment", name: "Program Enrollment Register", to: "../tcl-register", countKey: "enrollment", status: "available",
        desc: "General per-resident enrollment and follow-up register across community health programs." },
    ],
  },
];

const COUNT_FETCHERS = {
  maternal: () => maternalApi.list(),
  enrollment: () => tclApi.list(),
  "ncd-risk": () => programFormsApi["ncd-risk"].list(),
  "ncd-cervical": () => programFormsApi["ncd-cervical"].list(),
  "ncd-visual": () => programFormsApi["ncd-visual"].list(),
  "oral-health": () => programFormsApi["oral-health"].list(),
  environmental: () => programFormsApi.environmental.list(),
};

export default function TclWorkspace() {
  const [counts, setCounts] = useState({}); // key -> number | 'error'
  const [query, setQuery] = useState("");
  const location = useLocation();
  const role = (location.pathname.match(/^\/app\/([^/]+)\//) || [])[1] || "";

  useEffect(() => {
    let active = true;
    const keys = Object.keys(COUNT_FETCHERS);
    Promise.allSettled(keys.map((k) => COUNT_FETCHERS[k]())).then((results) => {
      if (!active) return;
      const next = {};
      results.forEach((res, i) => {
        const key = keys[i];
        if (res.status === "fulfilled") {
          const rows = res.value?.rows || res.value || [];
          next[key] = Array.isArray(rows) ? rows.length : 0;
        } else {
          next[key] = "error";
        }
      });
      setCounts(next);
    });
    return () => { active = false; };
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS
      .map((g) => ({ ...g, items: g.items.filter((it) => it.name.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length);
  }, [query]);

  // Record counts come from the role-scoped list APIs, so label them honestly.
  const scopeLabel = role === "health_supervisor"
    ? "in your assigned barangay"
    : (role === "phn" || role === "mho") ? "in your municipality" : "you can access";

  return (
    <>
      {/* Compact header */}
      <div className="mb-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          <span>Records</span>
          <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden="true" />
          <span className="text-brand-blue">TCL</span>
        </nav>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-brand-ink">Target Client Lists</h1>
        <p className="mt-0.5 text-sm text-brand-gray">Choose a health program to view its client list, register a client, or update follow-up records.</p>
      </div>

      {/* Compact search + scope note on one row */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex h-11 w-full max-w-sm items-center gap-2 rounded-btn border border-brand-border bg-white px-3 focus-within:border-brand-blue">
          <Search className="h-4 w-4 shrink-0 text-brand-gray" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a Target Client List…" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <p className="min-w-0 text-xs text-brand-gray">Record counts reflect saved records {scopeLabel}.</p>
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">{group.title}</h2>
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {group.items.map((it) => {
                const count = it.countKey ? counts[it.countKey] : undefined;
                const gatedOut = it.requiresRole && role !== it.requiresRole;
                const unavailable = it.status === "unavailable" || gatedOut;
                const blockedMsg = gatedOut
                  ? "Open from Health Supervisor › Records › M1 · Maternal Record."
                  : it.blocked;
                return (
                  <Card key={it.id} className="flex h-full flex-col gap-2 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-blue" />
                          <h3 className="truncate text-sm font-semibold text-brand-ink">{it.name}</h3>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-brand-gray">{it.desc}</p>
                      </div>
                      {!unavailable && typeof count === "number" && (
                        <span className="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand-blue" title={`Saved records ${scopeLabel}`}>
                          {count} record{count === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>

                    {unavailable ? (
                      <div className="mt-auto flex items-start gap-1.5 rounded-btn border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] leading-snug text-brand-gray">
                        <Clock className="mt-px h-3.5 w-3.5 shrink-0" /> <span>{blockedMsg}</span>
                      </div>
                    ) : (
                      <div className="mt-auto flex flex-wrap items-center gap-2">
                        <Link to={it.to} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
                          Open TCL <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                        {count === "error" && <span className="text-xs text-brand-danger">Count unavailable</span>}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
