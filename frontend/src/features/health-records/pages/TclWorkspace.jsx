import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card } from "@/components/common/Card";
import PageHeader from "@/components/common/PageHeader";
import {
  ArrowRight,
  Search,
  Clock,
  HeartPulse,
  Users,
  Baby,
  Activity,
  Ribbon,
  Eye,
  Smile,
  Home,
  ClipboardList,
  FileSpreadsheet,
} from "lucide-react";
import { programFormsApi, maternalApi, tclApi } from "@/services/api";

/**
 * Target Client List workspace — the single entry point reached from
 * Records → TCL. It lists every available official TCL grouped by health
 * program, with a short description, a real record count (when it loads) and an
 * "Open TCL" action into the actual working form. Source-dependent forms with
 * no official workbook yet are shown as awaiting their reference file.
 */

// countKey: how to fetch a real record count (null = no count shown).
// icon: a small, understated lucide glyph shown in a lightly tinted container.
const GROUPS = [
  {
    title: "Maternal and Family Health",
    items: [
      { id: "maternal", name: "Prenatal and Postpartum", icon: HeartPulse, to: "../maternal-tcl", countKey: "maternal", status: "available", requiresRole: "health_supervisor",
        desc: "Pregnant and postpartum mothers — LMP/EDC, prenatal check-ups, immunization, laboratory screening, delivery and postpartum care." },
      { id: "family-planning", name: "Family Planning", icon: Users, status: "unavailable",
        desc: "Family planning clients, method and follow-up visits.", blocked: "Awaiting the official Family Planning TCL workbook (pp-055-056-FP-TCL)." },
      { id: "child-care", name: "Child Care", icon: Baby, status: "unavailable",
        desc: "Child-health target client lists (0–11 mos, under-5, 5–9, 10–19, sick child).", blocked: "Awaiting the official Child Care TCL workbook (CC-TCL-FHO)." },
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

  const hasResults = groups.length > 0;

  // Record counts come from the role-scoped list APIs, so label them honestly.
  const scopeLabel = role === "health_supervisor"
    ? "in your assigned barangay"
    : (role === "phn" || role === "mho") ? "in your municipality" : "you can access";

  return (
    <>
      <PageHeader
        crumbs={["Records"]}
        title="Target Client Lists"
        subtitle="Access health program records, register clients, and manage follow-ups."
      />

      <Card className="mb-5 p-4">
        <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a Target Client List…"
            aria-label="Search Target Client Lists"
            className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-brand-gray">Record counts reflect saved records {scopeLabel}.</p>
      </Card>

      {!hasResults ? (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-brand-ink">No Target Client Lists match “{query}”.</p>
          <p className="text-xs text-brand-gray">Try a different program name or clear the search.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.title}>
              {/* Uppercase, letter-spaced label with a thin rule across the remaining width. */}
              <div className="mb-3 flex items-center gap-3">
                <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-gray">{group.title}</h2>
                <span className="h-px flex-1 bg-brand-border" aria-hidden="true" />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((it) => {
                  const count = it.countKey ? counts[it.countKey] : undefined;
                  const gatedOut = it.requiresRole && role !== it.requiresRole;
                  const unavailable = it.status === "unavailable" || gatedOut;
                  const blockedMsg = gatedOut
                    ? "Open from Health Supervisor › Records › M1 · Maternal Record."
                    : it.blocked;
                  const Icon = it.icon || FileSpreadsheet;
                  return (
                    <Card key={it.id} className="flex h-full flex-col p-4 transition-colors hover:border-brand-rule">
                      {/* Icon + status/count badge */}
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-brand-light text-brand-blue">
                          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                        </span>
                        {unavailable ? (
                          <span className="inline-flex shrink-0 items-center rounded-btn border border-brand-border bg-brand-paper px-2 py-0.5 text-[11px] font-medium text-brand-gray">
                            Awaiting workbook
                          </span>
                        ) : typeof count === "number" ? (
                          <span
                            className="inline-flex shrink-0 items-center rounded-btn border border-brand-border bg-brand-paper px-2 py-0.5 text-[11px] font-medium font-stat text-brand-gray"
                            title={`Saved records ${scopeLabel}`}
                          >
                            {count} record{count === 1 ? "" : "s"}
                          </span>
                        ) : count === "error" ? (
                          <span className="inline-flex shrink-0 items-center rounded-btn border border-brand-border bg-brand-paper px-2 py-0.5 text-[11px] font-medium text-brand-gray">
                            Count unavailable
                          </span>
                        ) : null}
                      </div>

                      {/* Title + description */}
                      <h3 className="mt-3 text-sm font-semibold leading-snug text-brand-ink">{it.name}</h3>
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-brand-gray">{it.desc}</p>

                      {/* Primary action / unavailable note, aligned to the bottom */}
                      <div className="mt-auto pt-4">
                        {unavailable ? (
                          <div className="flex items-start gap-1.5 rounded-btn border border-brand-border bg-brand-paper px-2.5 py-1.5 text-[11px] leading-snug text-brand-gray">
                            <Clock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>{blockedMsg}</span>
                          </div>
                        ) : (
                          <Link
                            to={it.to}
                            aria-label={`Open ${it.name} Target Client List`}
                            className="group inline-flex items-center gap-1.5 rounded-btn text-sm font-semibold text-brand-blue transition-colors hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                          >
                            Open TCL
                            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
