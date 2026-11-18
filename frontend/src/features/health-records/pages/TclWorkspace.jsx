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
  maternal: ({ ownerId, online }) =>
    listMaternalOffline({ ownerId, fetchFn: () => maternalApi.list(), online }),
  enrollment: ({ ownerId, online }) =>
    listTclOffline({ ownerId, fetchFn: () => tclApi.list(), online }),
  "ncd-risk": ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "ncd-risk", fetchFn: () => programFormsApi["ncd-risk"].list(), online }),
  "ncd-cervical": ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "ncd-cervical", fetchFn: () => programFormsApi["ncd-cervical"].list(), online }),
  "ncd-visual": ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "ncd-visual", fetchFn: () => programFormsApi["ncd-visual"].list(), online }),
  "oral-health": ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "oral-health", fetchFn: () => programFormsApi["oral-health"].list(), online }),
  environmental: ({ ownerId, online }) =>
    listProgramFormOffline({ ownerId, kind: "environmental", fetchFn: () => programFormsApi.environmental.list(), online }),
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
    const keys = Object.keys(COUNT_FETCHERS);
    Promise.allSettled(
      keys.map((k) => COUNT_FETCHERS[k]({ ownerId: user.id, online: () => online })),
    ).then((results) => {
      if (!active) return;
      const next = {};
      let anyCache = false;
      let anyStale = false;
      let hasCachedData = false;
      let latestCachedAt = null;
      results.forEach((res, i) => {
        const key = keys[i];
        if (res.status === "fulfilled") {
          const { rows = [], source, cachedAt, stale } = res.value || {};
          if (source === "cache") {
            anyCache = true;
            if (stale) anyStale = true;
            if (Number.isFinite(cachedAt) && (latestCachedAt === null || cachedAt > latestCachedAt)) {
              latestCachedAt = cachedAt;
            }
            // Never report an uncached program as 0 offline — surface "Count unavailable".
            if (!cachedAt && rows.length === 0) {
              next[key] = "error";
            } else {
              hasCachedData = true;
              next[key] = rows.length;
            }
          } else {
            next[key] = Array.isArray(rows) ? rows.length : 0;
          }
        } else {
          next[key] = "error";
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
