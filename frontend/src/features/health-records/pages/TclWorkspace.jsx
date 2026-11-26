// frontend/src/features/health-records/pages/TclWorkspace.jsx
import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  HeartPulse,
  Activity,
  Ribbon,
  Eye,
  Smile,
  Home,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import OfflineCacheNotice from "@/features/offline/components/OfflineCacheNotice";
import {
  listMaternalOffline,
  listTclOffline,
  listProgramFormOffline,
} from "@/services/offline/clinicalOfflineService";
import { programFormsApi, maternalApi, tclApi } from "@/services/api";
import HealthProgramDirectory from "../components/HealthProgramDirectory";

/**
 * Target Client List workspace — the single entry point reached from
 * Records → TCL. It lists every available official TCL grouped by health
 * program, with a short description, a real record count (when it loads) and an
 * "Open TCL" action into the actual working form. Programs without a working
 * form yet are shown as not yet available, without any placeholder panel.
 *
 * The directory uses the same compact program-card surface as M1.
 */

// countKey: M1 program id used by the authoritative count endpoint.
// icon: a small, understated lucide glyph shown in a lightly tinted container.
const GROUPS = [
  {
    title: "Maternal and Family Health",
    items: [
      { id: "maternal", name: "Prenatal and Postpartum", icon: HeartPulse, to: "../maternal-tcl", countKey: "prenatal", status: "available", requiresRole: "health_supervisor",
        desc: "Pregnant and postpartum mothers — LMP/EDC, prenatal check-ups, immunization, laboratory screening, delivery and postpartum care." },
    ],
  },
  {
    title: "Screening and Preventive Care",
    items: [
      { id: "ncd-risk", name: "NCD Risk Assessment", icon: Activity, to: "../ncd?tab=ncd-risk", countKey: "ncd", status: "available",
        desc: "Adults 20 y/o and above — smoking, alcohol, overweight/obesity, hypertension and diabetes screening (Part 1)." },
      { id: "ncd-cervical", name: "Cervical Cancer and Breast Mass Examination", icon: Ribbon, to: "../ncd?tab=ncd-cervical", countKey: "cervical", status: "available",
        desc: "VIA / Pap smear results, risk status, and suspicious breast-mass findings (Part 2)." },
      { id: "ncd-visual", name: "Visual Acuity and PPV", icon: Eye, to: "../ncd?tab=ncd-visual", countKey: "visual", status: "available",
        desc: "Senior citizens — eye complaints, visual acuity, pinhole, referral management and PPV immunization (Part 3)." },
      { id: "oral-health", name: "Oral Health", icon: Smile, to: "../oral-health", countKey: "oral", status: "available",
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
  prenatal: ({ ownerId, online }) =>
    listMaternalOffline({ ownerId, fetchFn: () => maternalApi.list(), online }),
  ncd: ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "ncd-risk", fetchFn: () => programFormsApi["ncd-risk"].list(), online }),
  cervical: ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "ncd-cervical", fetchFn: () => programFormsApi["ncd-cervical"].list(), online }),
  visual: ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "ncd-visual", fetchFn: () => programFormsApi["ncd-visual"].list(), online }),
  oral: ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "oral-health", fetchFn: () => programFormsApi["oral-health"].list(), online }),
  environmental: ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "environmental", fetchFn: () => programFormsApi.environmental.list(), online }),
  enrollment: ({ ownerId, online }) =>
    listTclOffline({ ownerId, fetchFn: () => tclApi.list(), online }),
};

export default function TclWorkspace() {
  const { user } = useAuth();
  const { online, lastSyncedAt } = useSyncStatus();
  const [counts, setCounts] = useState({}); // key -> number | 'error'
  const [loading, setLoading] = useState(true);
  const [cacheInfo, setCacheInfo] = useState({ source: null, cachedAt: null, stale: false, hasCachedData: false });
  const location = useLocation();
  const role = (location.pathname.match(/^\/app\/([^/]+)\//) || [])[1] || "";

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setCounts({});
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    Promise.allSettled(
      Object.entries(COUNT_FETCHERS).map(([key, fetchCount]) =>
        fetchCount({ ownerId: user.id, online: () => online }).then((result) => [key, result]),
      ),
    ).then((results) => {
      if (!active) return;
      const next = {};
      let anyCache = false;
      let anyStale = false;
      let hasCachedData = false;
      let latestCachedAt = null;
      results.forEach((result, index) => {
        const key = Object.keys(COUNT_FETCHERS)[index];
        if (result.status !== "fulfilled") {
          next[key] = "error";
          return;
        }

        const [, { rows = [], source, cachedAt, stale }] = result.value;
        if (source === "cache") {
          anyCache = true;
          anyStale ||= Boolean(stale);
          if (Number.isFinite(cachedAt)) {
            hasCachedData = true;
            latestCachedAt = latestCachedAt === null ? cachedAt : Math.max(latestCachedAt, cachedAt);
          }
          next[key] = !Number.isFinite(cachedAt) && rows.length === 0 ? "error" : rows.length;
        } else {
          next[key] = rows.length;
        }
      });
      setCounts(next);
      setCacheInfo({
        source: anyCache ? "cache" : "server",
        cachedAt: latestCachedAt,
        stale: anyStale,
        hasCachedData,
      });
      setLoading(false);
    });
    return () => { active = false; };
  }, [user?.id, online]);

  // Record counts come from the role-scoped list APIs, so label them honestly.
  const scopeLabel = role === "health_supervisor"
    ? "in your assigned barangay"
    : (role === "phn" || role === "mho") ? "in your municipality" : "you can access";

  const programs = GROUPS.flatMap((group) => group.items.map((item) => {
    const recordCount = item.countKey ? counts[item.countKey] : undefined;
    const gatedOut = item.requiresRole && role !== item.requiresRole;
    const disabled = item.status === "unavailable" || gatedOut;

    return {
      id: item.id,
      name: item.name,
      description: item.desc,
      category: group.title,
      icon: item.icon,
      to: item.to,
      disabled,
      disabledReason: gatedOut
        ? "Available from the Health Supervisor program directory."
        : "This program is not yet available.",
      recordCount,
      countState: loading && recordCount == null
        ? "loading"
        : typeof recordCount === "number"
          ? "ready"
          : "error",
    };
  }));

  return (
    <HealthProgramDirectory
      programs={programs}
      crumbs={["Clinical Care", "TCL"]}
      subtitle="Review target client lists and program records within your authorized service area."
      notices={cacheInfo.source === "cache" ? (
        <OfflineCacheNotice
          source={cacheInfo.source}
          cachedAt={cacheInfo.cachedAt}
          lastSyncedAt={lastSyncedAt}
          stale={cacheInfo.stale}
          empty={!cacheInfo.hasCachedData}
          className="!mb-0"
        />
      ) : null}
      countNote={`Record counts reflect saved records ${scopeLabel}.`}
      showSectionSummary={false}
    />
  );
}
