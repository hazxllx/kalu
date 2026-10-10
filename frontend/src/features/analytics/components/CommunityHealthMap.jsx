import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { RefreshCw, MapPin, Home, AlertCircle } from "lucide-react";

import { fetchCommunityMap, fetchHouseholdMap } from "@/services/api/earlyWarningApi";

/**
 * Community Health Map — real interactive Leaflet map for disease/health
 * monitoring by barangay.
 *
 * This is NOT a navigation map and it never shows individual residents,
 * households or exact coordinates: it plots ONE reference point per barangay
 * and shades it by the AGGREGATED case count for the selected condition/date
 * (the "heatmap" intensity). Data and geographic scope come from
 * GET /api/analytics/community-map, which the backend scopes to the
 * authenticated session (Health Supervisor → their assigned barangay only;
 * MHO/PHN → every barangay in their municipality). Only barangays that have a
 * verified reference point in the database are plotted.
 *
 * Two usage modes:
 *   - Controlled: pass `barangays` (+ optional `center`, `onSelect`,
 *     `selectedName`). The parent owns fetching/filters (used by Community
 *     Monitoring).
 *   - Self-contained: pass nothing and the component fetches the unfiltered
 *     map itself (legacy callers).
 */

// Fallback centre: Municipality of Pili — only used when neither a server
// centre nor a plotted barangay is available to frame the view.
const PILI_CENTER = [13.55417, 123.27528];

const hasValidCoordinates = (point) => {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  return (
    point?.hasCoordinates === true &&
    point.latitude != null &&
    point.longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

function FitToMarkers({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
    } else {
      map.fitBounds(points, { padding: [40, 40] });
    }
  }, [map, points]);
  return null;
}

// Leaflet needs the real pixel size of its container. When the map lives inside
// a flex/grid column (as in Community Monitoring) it can render before the
// column has its final width, leaving grey tiles or a clipped view. Recompute
// the size after mount and whenever the container is resized by layout,
// sidebar, or viewport changes.
function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const invalidate = () => map.invalidateSize();
    const timer = setTimeout(invalidate, 200);
    const container = map.getContainer();
    let observer;
    if (typeof ResizeObserver !== "undefined" && container) {
      observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(container);
    }
    window.addEventListener("resize", invalidate);
    return () => {
      clearTimeout(timer);
      if (observer) observer.disconnect();
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);
  return null;
}

// Sequential intensity ramp (neutral → high). `intensity` is 0..1 relative to
// the busiest barangay in the current scope; 0 (no reported data) is neutral.
function intensityColor(intensity, caseCount) {
  if (!caseCount) return "#94A3B8"; // slate-400 — no reported data
  if (intensity >= 0.75) return "#B91C1C"; // red-700
  if (intensity >= 0.5) return "#EA580C"; // orange-600
  if (intensity >= 0.25) return "#F59E0B"; // amber-500
  return "#F6C453"; // low
}

const COMMUNITY_RISK_LEVELS = [
  {
    label: "High Risk",
    description: "High community health risk",
    color: "#B91C1C",
  },
  {
    label: "Moderate Risk",
    description: "Moderate community health risk",
    color: "#EA580C",
  },
  {
    label: "Low Risk",
    description: "Low community health risk",
    color: "#16A34A",
  },
  {
    label: "No Data",
    description: "Classification unavailable",
    color: "#94A3B8",
  },
];

const VALID_COMMUNITY_RISK_LEVELS = new Set(
  COMMUNITY_RISK_LEVELS.slice(0, 3).map((level) => level.label),
);

// The map API may provide a persisted, authorized community classification in
// future deployments. Never infer one from case counts or population here.
function communityRiskLevel(barangay) {
  const level = String(
    barangay?.communityRiskLevel ?? barangay?.riskLevel ?? barangay?.risk_level ?? "",
  ).trim();
  return VALID_COMMUNITY_RISK_LEVELS.has(level) ? level : "No Data";
}

function communityRiskColor(level) {
  return COMMUNITY_RISK_LEVELS.find((item) => item.label === level)?.color || "#94A3B8";
}

// Household risk marker colour. Active-case households are emphasised; the
// colour reflects the household risk level reported by the backend.
function householdColor(riskLevel, hasActiveCase) {
  if (hasActiveCase) {
    if (riskLevel === "High") return "#B91C1C"; // red-700
    if (riskLevel === "Moderate" || riskLevel === "Medium") return "#EA580C"; // orange-600
    return "#F59E0B"; // amber-500
  }
  return "#2563EB"; // brand blue — household with no active case
}

export default function CommunityHealthMap({
  barangays: barangaysProp = null,
  center: centerProp = null,
  onSelect = null,
  selectedName = null,
  loading: loadingProp = null,
  error: errorProp = null,
  onRetry = null,
  onClearFilters = null,
  showHouseholds = false,
  householdBarangay = null,
}) {
  const controlled = Array.isArray(barangaysProp);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!controlled);
  const [error, setError] = useState("");

  // Household markers (clustered per family). Loaded independently so the
  // barangay heatmap keeps working even if the household layer is unavailable.
  const [households, setHouseholds] = useState([]);
  const [householdError, setHouseholdError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchCommunityMap()
      .then((res) => setData(res))
      .catch((err) => setError(err?.message || "Unable to load community health data."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (controlled) return;
    load();
  }, [controlled, load]);

  // Load household markers only when the caller asks for the household layer.
  useEffect(() => {
    if (!showHouseholds) {
      setHouseholds([]);
      return;
    }
    let active = true;
    setHouseholdError("");
    fetchHouseholdMap({ barangay: householdBarangay })
      .then((res) => {
        if (active) setHouseholds(res?.households || []);
      })
      .catch(() => {
        if (active) setHouseholdError("Unable to load household markers.");
      });
    return () => {
      active = false;
    };
  }, [showHouseholds, householdBarangay]);

  const barangays = controlled ? barangaysProp : data?.barangays || [];
  const isLoading = controlled ? Boolean(loadingProp) : loading;
  const errText = controlled ? errorProp || "" : error;
  const center = centerProp || (controlled ? null : data?.center) || null;

  const plotted = useMemo(() => barangays.filter(hasValidCoordinates), [barangays]);
  const missing = useMemo(() => barangays.filter((b) => !hasValidCoordinates(b)), [barangays]);
  const plottedHouseholds = useMemo(
    () => households.filter(hasValidCoordinates),
    [households],
  );
  const points = useMemo(() => {
    const barangayPoints = plotted.map((b) => [b.latitude, b.longitude]);
    const householdPoints = plottedHouseholds.map((h) => [h.latitude, h.longitude]);
    return [...barangayPoints, ...householdPoints];
  }, [plotted, plottedHouseholds]);
  const centerPoint = hasValidCoordinates({ ...center, hasCoordinates: true })
    ? [Number(center.latitude), Number(center.longitude)]
    : points[0] || PILI_CENTER;

  const retry = controlled ? onRetry : load;

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-xl border border-brand-border bg-brand-bg p-4">
        <div className="h-[300px] w-full rounded-lg bg-slate-200/70" />
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2.5 w-24 rounded bg-slate-200/70" />
          <div className="h-2.5 w-16 rounded bg-slate-200/70" />
          <div className="h-2.5 w-16 rounded bg-slate-200/70" />
        </div>
      </div>
    );
  }

  if (errText) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
        <AlertCircle className="h-5 w-5 text-brand-danger" strokeWidth={1.8} />
        <p className="text-sm font-semibold text-brand-ink">Unable to load community health data.</p>
        <p className="text-xs text-brand-gray">{typeof errText === "string" ? errText : "Please try again."}</p>
        {retry && (
          <button
            onClick={retry}
            className="mt-1 inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        )}
      </div>
    );
  }

  if (barangays.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
        <MapPin className="h-5 w-5 text-brand-gray" strokeWidth={1.6} />
        <p className="text-sm font-semibold text-brand-ink">No health data recorded</p>
        <p className="max-w-sm text-xs text-brand-gray">
          No barangays are available for your scope during the selected period.
        </p>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="mt-1 inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
          >
            Clear Filters
          </button>
        )}
      </div>
    );
  }

  const MapContainerCompat = /** @type {any} */ (MapContainer);
  const TileLayerCompat = /** @type {any} */ (TileLayer);
  const CircleMarkerCompat = /** @type {any} */ (CircleMarker);
  const PopupCompat = /** @type {any} */ (Popup);

  return (
    <div>
      {plotted.length === 0 && plottedHouseholds.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
          <MapPin className="h-5 w-5 text-brand-gray" strokeWidth={1.6} />
          <p className="text-sm font-semibold text-brand-ink">No mappable health data</p>
          <p className="max-w-sm text-xs text-brand-gray">
            None of the barangays in your scope have verified map coordinates for the selected period.
          </p>
          {onClearFilters && (
            <button
              onClick={onClearFilters}
              className="mt-1 inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-brand-border">
          <MapContainerCompat
            center={centerPoint}
            zoom={13}
            scrollWheelZoom={false}
            style={{ height: "420px", width: "100%" }}
          >
            <TileLayerCompat
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitToMarkers points={points} />
            <InvalidateSize />
            {plotted.map((b) => {
              const caseCount = b.caseCount ?? 0;
              const fillColor = intensityColor(b.intensity ?? 0, caseCount);
              const riskColor = communityRiskColor(communityRiskLevel(b));
              const isSelected = selectedName && b.name === selectedName;
              return (
                <CircleMarkerCompat
                  key={b.id}
                  center={[b.latitude, b.longitude]}
                  radius={isSelected ? 16 : 12}
                  pathOptions={{
                    color: riskColor,
                    fillColor,
                    fillOpacity: caseCount ? 0.7 : 0.4,
                    weight: isSelected ? 4 : 2,
                  }}
                  eventHandlers={onSelect ? { click: () => onSelect(b) } : undefined}
                >
                  <PopupCompat>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold">{b.name}</p>
                      <p className="text-xs">Total cases: {caseCount}</p>
                      {"activeCases" in b && <p className="text-xs">Active: {b.activeCases}</p>}
                      {"newCases" in b && <p className="text-xs">New (this month): {b.newCases}</p>}
                      {onSelect && (
                        <button
                          type="button"
                          onClick={() => onSelect(b)}
                          className="mt-1 text-xs font-semibold text-brand-blue underline"
                        >
                          View barangay details
                        </button>
                      )}
                    </div>
                  </PopupCompat>
                </CircleMarkerCompat>
              );
            })}
            {/* Household markers (clustered per family). ONE marker per household;
                no resident identity is ever shown — household-level data only. */}
            {plottedHouseholds.map((h) => {
              const color = householdColor(h.riskLevel, h.hasActiveCase);
              return (
                <CircleMarkerCompat
                  key={`hh-${h.id}`}
                  center={[h.latitude, h.longitude]}
                  radius={h.hasActiveCase ? 9 : 6}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: h.hasActiveCase ? 0.85 : 0.5,
                    weight: h.hasActiveCase ? 3 : 1.5,
                  }}
                >
                  <PopupCompat>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold">Household {h.householdNo}</p>
                      {h.barangay && <p className="text-xs">Barangay: {h.barangay}</p>}
                      <p className="text-xs">Members: {h.memberCount}</p>
                      <p className="text-xs">Risk level: {h.riskLevel || "Low"}</p>
                      <p className="text-xs">
                        Status:{" "}
                        <span className={h.hasActiveCase ? "font-semibold text-rose-700" : ""}>
                          {h.hasActiveCase ? `Active health risk (${h.activeCases})` : "No active case"}
                        </span>
                      </p>
                    </div>
                  </PopupCompat>
                </CircleMarkerCompat>
              );
            })}
          </MapContainerCompat>
        </div>
      )}

      <div className="mt-3 rounded-lg border border-brand-border bg-white/95 p-3 shadow-sm">
        <p className="text-xs font-semibold text-brand-ink">Community Health Risk</p>
        <p className="mt-0.5 text-[11px] text-brand-gray">
          Marker outlines use the authorized barangay classification when provided; case intensity remains the fill.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
          {COMMUNITY_RISK_LEVELS.map((level) => (
            <span key={level.label} className="inline-flex min-w-0 items-center gap-1.5 text-xs text-brand-gray">
              <span
                className="h-3 w-3 shrink-0 rounded-full border-2 bg-white"
                style={{ borderColor: level.color }}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block font-medium text-brand-ink">{level.label}</span>
                <span className="block truncate text-[10px]">{level.description}</span>
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Case-intensity legend + any barangays we could not plot (coordinates unavailable). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-gray">
        <span className="font-medium text-brand-ink">Case intensity:</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#94A3B8" }} /> No data</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F59E0B" }} /> Lower</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#B91C1C" }} /> Higher</span>
        {showHouseholds && (
          <span className="inline-flex items-center gap-1.5">
            <Home className="h-3 w-3 text-brand-blue" /> Household marker
          </span>
        )}
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-brand-gray">
          Coordinates unavailable (not plotted): {missing.map((b) => b.name).join(", ")}.
        </p>
      )}
      {showHouseholds && householdError && (
        <p className="mt-2 text-xs text-brand-danger">{householdError}</p>
      )}
    </div>
  );
}
