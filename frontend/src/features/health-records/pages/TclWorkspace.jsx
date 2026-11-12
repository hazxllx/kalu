import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card } from "@/components/common/Card";
import PageHeader from "@/components/common/PageHeader";
import {
  ArrowRight,
  Search,
  HeartPulse,
  Activity,
  Ribbon,
  Eye,
  Smile,
  Home,
  ClipboardList,
  FileSpreadsheet,
} from "lucide-react";
import { programFormsApi, maternalApi, tclApi } from "@/services/api";
import TclEmptyState from "../components/TclEmptyState";
import { TclDirectorySkeleton } from "../components/TclSkeletons";

/**
 * Target Client List workspace — the single entry point reached from
 * Records → TCL. It lists every available official TCL grouped by health
 * program, with a short description, a real record count (when it loads) and an
 * "Open TCL" action into the actual working form. Programs without a working
 * form yet are shown as not yet available, without any placeholder panel.
 *
 * REDESIGNED: Compact two-column directory with horizontal program cards,
 * refined category headings, and consolidated search toolbar.
 */

// countKey: how to fetch a real record count (null = no count shown).
// icon: a small, understated lucide glyph shown in a lightly tinted container.
const GROUPS = [
  {
    title: "Maternal and Family Health",
    items: [
      { id: "maternal", name: "Prenatal and Postpartum", icon: HeartPulse, to: "../maternal-tcl", countKey: "maternal", status: "available", requiresRole: "health_supervisor",
        desc: "Pregnant and postpartum mothers — LMP/EDC, prenatal check-ups, immunization, laboratory screening, delivery and postpartum care." },
    ],
  },
  {
    title: "Screening and Preventive Care",
    items: [
      { id: "ncd-risk", name: "NCD Risk Assessment", icon: Activity, to: "../ncd?tab=ncd-risk", countKey: "ncd-risk", status: "available",
        desc: "Adults 20 y/o and above — smoking, alcohol, overweight/obesity, hypertension and diabetes screening (Part 1)." },
      { id: "ncd-cervical", name: "Cervical Cancer and Breast Mass Examination", icon: Ribbon, to: "../ncd?tab=ncd-cervical", countKey: "ncd-cervical", status: "available",
        desc: "VIA / Pap smear results, risk status, and suspicious breast-mass findings (Part 2)." },
      { id: "ncd-visual", name: "Visual Acuity and PPV", icon: Eye, to: "../ncd?tab=ncd-visual", countKey: "ncd-visual", status: "available",
        desc: "Senior citizens — eye complaints, visual acuity, pinhole, referral management and PPV immunization (Part 3)." },
      { id: "oral-health", name: "Oral Health", icon: Smile, to: "../oral-health", countKey: "oral-health", status: "available",
        desc: "Individual oral-health client records and services, plus the separate BOHC statistical table." },
    ],
  },
  {
    title: "Environmental Health",
    items: [
      { id: "environmental", name: "Household Environmental Masterlist", icon: Home, to: "../environmental", countKey: "environmental", status: "available",
        desc: "Per-household water supply, sanitation facilities, waste management and complete-sanitation indicators (Parts 1–4)." },
    ],
  },
  {
    title: "Community Health Programs",
    items: [
      { id: "enrollment", name: "Program Enrollment Register", icon: ClipboardList, to: "../tcl-register", countKey: "enrollment", status: "available",
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
  const [loading, setLoading] = useState(true);
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
      setLoading(false);
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

  const hasResults = groups.length > 0;
  const totalPrograms = groups.reduce((sum, g) => sum + g.items.length, 0);

  // Record counts come from the role-scoped list APIs, so label them honestly.
  const scopeLabel = role === "health_supervisor"
    ? "in your assigned barangay"
    : (role === "phn" || role === "mho") ? "in your municipality" : "you can access";

  return (
    <>
      <PageHeader
        dense
        crumbs={["Clinical Care", "TCL"]}
        title="Target Client Lists"
        subtitle="Access health program records, register clients, and manage follow-ups."
      />

      {/* Search and Program Summary Toolbar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2 rounded-btn border border-brand-border bg-brand-paper px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search health programs or target client lists…"
            aria-label="Search Target Client Lists"
            className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray"
          />
        </div>
        {hasResults && (
          <div className="flex shrink-0 items-center rounded-btn border border-brand-border bg-brand-paper px-3 py-2 text-[11px] font-medium text-brand-gray whitespace-nowrap">
            {totalPrograms} program{totalPrograms === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {!hasResults ? (
        <TclEmptyState
          title="No Target Client Lists found"
          description={`No programs match "${query}". Try a different search term or clear the filter.`}
          type="search"
        />
      ) : loading ? (
        <TclDirectorySkeleton count={6} />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.title}>
              {/* Category Heading with divider */}
              <div className="mb-3 flex items-center gap-3">
                <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-ink">
                  {group.title}
                </h2>
                <span className="h-px flex-1 bg-brand-border" aria-hidden="true" />
              </div>

              {/* Two-Column Grid Layout */}
              <div className="grid gap-3 lg:grid-cols-2">
                {group.items.map((it) => {
                  const count = it.countKey ? counts[it.countKey] : undefined;
                  const gatedOut = it.requiresRole && role !== it.requiresRole;
                  const unavailable = it.status === "unavailable" || gatedOut;
                  const note = gatedOut
                    ? "Open from Health Supervisor › Records › M1 · Maternal Record."
                    : "Not yet available";
                  const Icon = it.icon || FileSpreadsheet;

                  return (
                    <Link
                      key={it.id}
                      to={unavailable ? "#" : it.to}
                      className={`group flex items-center gap-3 rounded-btn border px-3.5 py-3 transition-all ${
                        unavailable
                          ? "cursor-not-allowed border-brand-border bg-brand-paper"
                          : "border-brand-border bg-brand-paper hover:border-brand-rule hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                      }`}
                      onClick={(e) => {
                        if (unavailable) e.preventDefault();
                      }}
                      aria-label={`Open ${it.name} Target Client List`}
                    >
                      {/* Left: Icon Container */}
                      <span
                        className={`flex shrink-0 items-center justify-center rounded-btn h-10 w-10 ${
                          unavailable ? "bg-brand-light text-brand-gray" : "bg-brand-light text-brand-blue"
                        }`}
                        aria-hidden="true"
                      >
                        <Icon className="h-[18px] w-[18px]" />
                      </span>

                      {/* Middle: Program Info */}
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold leading-tight text-brand-ink">
                          {it.name}
                        </h3>
                        <p className="mt-0.5 line-clamp-1 text-xs leading-tight text-brand-gray">
                          {unavailable ? note : it.desc}
                        </p>
                      </div>

                      {/* Right: Count Badge and Arrow */}
                      <div className="flex shrink-0 items-center gap-2">
                        {!unavailable && typeof count === "number" ? (
                          <span
                            className="inline-flex items-center rounded-btn border border-brand-border bg-brand-paper px-1.5 py-0.5 text-[10px] font-medium font-stat text-brand-gray"
                            title={`Saved records ${scopeLabel}`}
                          >
                            {count}
                          </span>
                        ) : !unavailable && count === "error" ? (
                          <span className="inline-flex items-center text-[10px] font-medium text-brand-gray">
                            —
                          </span>
                        ) : null}
                        {!unavailable && (
                          <ArrowRight className="h-3.5 w-3.5 text-brand-blue transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Scope Information */}
      <p className="mt-6 text-[11px] text-brand-gray">
        Record counts reflect saved records {scopeLabel}.
      </p>
    </>
  );
}
