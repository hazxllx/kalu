import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { RefreshCw, MapPin, AlertCircle } from "lucide-react";

import { fetchCommunityMap } from "@/services/api/earlyWarningApi";

setWorkerUrl(maplibreWorkerUrl);

const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> | <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> | Data from <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>';

function removeBasemapIcons(style) {
  if (!Array.isArray(style?.layers)) {
    throw new Error("The basemap style did not contain any map layers.");
  }

  return {
    ...style,
    layers: style.layers
      .filter((layer) => layer["source-layer"]?.toLowerCase() !== "poi")
      .map((layer) => {
        if (layer.type !== "symbol" || !layer.layout) return layer;
        return {
          ...layer,
          layout: Object.fromEntries(
            Object.entries(layer.layout).filter(([name]) => !name.startsWith("icon-")),
          ),
        };
      }),
  };
}

function IconFreeBasemap({ onError }) {
  const map = useMap();

  useEffect(() => {
    let active = true;
    let basemapLayer;

    fetch(BASEMAP_STYLE_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Basemap request failed with HTTP ${response.status}.`);
        }
        return response.json();
      })
      .then((style) => {
        if (!active) return;
        basemapLayer = maplibreGL({
          style: removeBasemapIcons(style),
          attributionControl: false,
        }).addTo(map);
        map.attributionControl?.addAttribution(BASEMAP_ATTRIBUTION);
      })
      .catch((error) => {
        if (!active) return;
        onError(error?.message || "Unable to load the geographic basemap.");
      });

    return () => {
      active = false;
      if (basemapLayer) basemapLayer.remove();
      map.attributionControl?.removeAttribution(BASEMAP_ATTRIBUTION);
    };
  }, [map, onError]);

  return null;
}

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
 *     map itself.
 */

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

export default function CommunityHealthMap({
  barangays: barangaysProp = null,
  center: centerProp = null,
  onSelect = null,
  selectedName = null,
  loading: loadingProp = null,
  error: errorProp = null,
  onRetry = null,
  onClearFilters = null,
  visibleConditions = null,
  showCountLabels = false,
  periodLabel = "All records",
}) {
  const controlled = Array.isArray(barangaysProp);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!controlled);
  const [error, setError] = useState("");
  const [basemapError, setBasemapError] = useState("");

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

  const barangays = controlled ? barangaysProp : data?.barangays || [];
  const isLoading = controlled ? Boolean(loadingProp) : loading;
  const errText = controlled ? errorProp || "" : error;
  const center = centerProp || (controlled ? null : data?.center) || null;

  const plotted = useMemo(() => barangays.filter(hasValidCoordinates), [barangays]);
  const missing = useMemo(() => barangays.filter((b) => !hasValidCoordinates(b)), [barangays]);
  const points = useMemo(() => plotted.map((b) => [b.latitude, b.longitude]), [plotted]);
  const markerData = useMemo(() => {
    const selected = Array.isArray(visibleConditions) ? new Set(visibleConditions) : null;
    const counts = plotted.map((barangay) => ({
      ...barangay,
      displayedCaseCount: showCountLabels && selected
        ? (barangay.conditions || [])
          .filter((item) => selected.has(item.name))
          .reduce((total, item) => total + item.value, 0)
        : barangay.caseCount ?? 0,
      displayedConditions: showCountLabels && selected
        ? (barangay.conditions || []).filter((item) => selected.has(item.name))
        : barangay.conditions || [],
    }));
    const maximum = Math.max(0, ...counts.map((item) => item.displayedCaseCount));
    return counts.map((item) => ({
      ...item,
      displayedIntensity: showCountLabels
        ? maximum > 0 ? item.displayedCaseCount / maximum : 0
        : item.intensity ?? 0,
    }));
  }, [plotted, visibleConditions, showCountLabels]);
  const visibleMarkers = showCountLabels
    ? markerData.filter((item) => item.displayedCaseCount > 0)
    : markerData;
  const centerPoint = hasValidCoordinates({ ...center, hasCoordinates: true })
    ? [Number(center.latitude), Number(center.longitude)]
    : points[0];

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
  const CircleMarkerCompat = /** @type {any} */ (CircleMarker);
  const PopupCompat = /** @type {any} */ (Popup);
  const TooltipCompat = /** @type {any} */ (Tooltip);

  return (
    <div>
      {plotted.length === 0 ? (
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
        <div className="relative overflow-hidden rounded-xl border border-brand-border">
          <MapContainerCompat
            center={centerPoint}
            zoom={13}
            scrollWheelZoom={false}
            style={{ height: "420px", width: "100%" }}
          >
            <IconFreeBasemap onError={setBasemapError} />
            <FitToMarkers points={points} />
            <InvalidateSize />
            {visibleMarkers.map((b) => {
              const caseCount = b.displayedCaseCount;
              const fillColor = intensityColor(b.displayedIntensity, caseCount);
              const isSelected = selectedName && b.name === selectedName;
              return (
                <CircleMarkerCompat
                  key={b.id}
                  center={[b.latitude, b.longitude]}
                  radius={Math.min(28, 13 + Math.sqrt(caseCount) * 1.2 + (isSelected ? 3 : 0))}
                  pathOptions={{
                    color: fillColor,
                    fillColor,
                    fillOpacity: caseCount ? 0.7 : 0.4,
                    weight: isSelected ? 4 : 2,
                  }}
                  eventHandlers={onSelect ? { click: () => onSelect(b) } : undefined}
                >
                  {showCountLabels && <TooltipCompat
                    permanent
                    direction="center"
                    className="health-map-count-tooltip"
                    opacity={1}
                  >
                    <span style={{
                      color: b.displayedIntensity >= 0.75 ? "#FFFFFF" : "#1F2937",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}>
                      {caseCount}
                    </span>
                  </TooltipCompat>}
                  <PopupCompat>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold">{b.name}</p>
                      <p className="text-xs">Total cases: {caseCount}</p>
                      {showCountLabels && <p className="text-xs">Reporting period: {periodLabel}</p>}
                      {(b.displayedConditions || b.conditions || []).filter((item) => item.value > 0).length > 0 && (
                        <ul className="mt-1 border-t border-slate-200 pt-1 text-xs">
                          {(b.displayedConditions || b.conditions || []).filter((item) => item.value > 0).map((item) => (
                            <li key={item.name} className="flex justify-between gap-3">
                              <span>{item.name}</span>
                              <span className="font-semibold">{item.value}</span>
                            </li>
                          ))}
                        </ul>
                      )}
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
          </MapContainerCompat>
          {basemapError && (
            <div
              role="alert"
              className="absolute bottom-3 left-3 z-[500] rounded-lg border border-amber-300 bg-white/95 px-3 py-2 text-xs text-amber-900 shadow-sm"
            >
              Geographic basemap unavailable. Health markers remain visible. {basemapError}
            </div>
          )}
          {showCountLabels && visibleMarkers.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
              <p className="rounded-lg border border-brand-border bg-white/95 px-4 py-2 text-sm font-medium text-brand-gray shadow-sm">
                No cases match the selected filters.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Case-intensity legend + any barangays we could not plot (coordinates unavailable). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-gray">
        <span className="font-medium text-brand-ink">Case intensity</span>
        <span className="text-[11px]">Relative to the busiest barangay in scope; not a clinical risk rating.</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#94A3B8" }} /> No data</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F6C453" }} /> Lower</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F59E0B" }} /> Moderate</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#EA580C" }} /> Elevated</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#B91C1C" }} /> Highest in scope</span>
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-brand-gray">
          Coordinates unavailable (not plotted): {missing.map((b) => b.name).join(", ")}.
        </p>
      )}
    </div>
  );
}
