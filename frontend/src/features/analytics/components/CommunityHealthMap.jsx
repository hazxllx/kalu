// frontend/src/features/analytics/components/CommunityHealthMap.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { MapContainer, CircleMarker, GeoJSON, Pane, Popup, Tooltip, ZoomControl, useMap } from "react-leaflet";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { RefreshCw, MapPin, AlertCircle } from "lucide-react";

import { fetchCommunityMap } from "@/services/api/earlyWarningApi";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { validPurokGeoJson } from "@/features/analytics/lib/purokGeometry";
import { DEFAULT_MAP_STYLE_URL } from "@/lib/localSafety";
import { conditionColor, mapLegend } from "@/features/analytics/lib/communityMapLegend";

setWorkerUrl(maplibreWorkerUrl);

const BASEMAP_STYLE_URL = import.meta.env?.VITE_MAP_STYLE_URL || DEFAULT_MAP_STYLE_URL;
const BASEMAP_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> · <a href="https://openfreemap.org">OpenFreeMap</a>';

// Handles removeBasemapIcons logic.
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

// Renders or manages IconFreeBasemap logic.
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

// Renders or manages FitToMarkers logic.
function FitToMarkers({ points, smooth = false, reducedMotion = false }) {
  const map = useMap();
  const previous = useRef("");
  useEffect(() => {
    if (!points.length) return;
    const geography = points.map((point) => point.join(",")).join(";");
    if (previous.current === geography) return;
    previous.current = geography;
    if (points.length === 1) {
      map.setView(points[0], 15, { animate: smooth && !reducedMotion, duration: 0.35 });
    } else {
      map.fitBounds(points, { padding: [40, 40], animate: smooth && !reducedMotion, duration: 0.35 });
    }
  }, [map, points, smooth, reducedMotion]);
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

// Renders or manages BoundaryAttribution logic.
function BoundaryAttribution({ visible }) {
  const map = useMap();
  useEffect(() => {
    if (!visible) return;
    const attribution = 'Boundaries: PSA/NAMRIA via <a href="https://data.humdata.org/dataset/cod-ab-phl">OCHA HDX</a>';
    map.attributionControl?.addAttribution(attribution);
    return () => map.attributionControl?.removeAttribution(attribution);
  }, [map, visible]);
  return null;
}

// Renders or manages CommunityHealthMap logic.
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
  variant = "default",
  height = 300,
  showNewCases = true,
  displayMetric = "caseCount",
  metricLabel = "Recorded cases",
  purokLayer = null,
  detailsHref = null,
  boundaryLayer = null,
  boundaryError = "",
}) {
  const dashboard = variant === "dashboard";
  const supervisor = variant === "supervisor" || dashboard;
  const reducedMotion = useReducedMotion();
  const controlled = Array.isArray(barangaysProp);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!controlled);
  const [error, setError] = useState("");
  const [basemapError, setBasemapError] = useState("");
  const [basemapVersion, setBasemapVersion] = useState(0);

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
  const boundaryFeatures = useMemo(() => (boundaryLayer?.features || []).filter((feature) => barangays.some((row) => row.name === feature.properties?.name)), [boundaryLayer, barangays]);
  const mapExtent = useMemo(() => {
    const vertices = [];
    const collect = (coordinates) => {
      if (!Array.isArray(coordinates)) return;
      if (coordinates.length >= 2 && coordinates.slice(0, 2).every(Number.isFinite)) vertices.push([coordinates[1], coordinates[0]]);
      else coordinates.forEach(collect);
    };
    boundaryFeatures.forEach((feature) => collect(feature.geometry?.coordinates));
    if (!vertices.length) return points;
    return [
      [Math.min(...vertices.map((point) => point[0])), Math.min(...vertices.map((point) => point[1]))],
      [Math.max(...vertices.map((point) => point[0])), Math.max(...vertices.map((point) => point[1]))],
      ...points,
    ];
  }, [boundaryFeatures, points]);
  
  const markerData = useMemo(() => {
    const selected = Array.isArray(visibleConditions) ? new Set(visibleConditions) : null;
    const counts = plotted.map((barangay) => ({
      ...barangay,
      displayedCaseCount: showCountLabels && selected && displayMetric === "caseCount"
        ? (barangay.conditions || [])
          .filter((item) => selected.has(item.name))
          .reduce((total, item) => total + item.value, 0)
        : barangay[displayMetric] ?? (displayMetric === "caseCount" ? 0 : null),
      displayedConditions: showCountLabels && selected
        ? (barangay.conditions || []).filter((item) => selected.has(item.name))
        : barangay.conditions || [],
    }));
    const maximum = Math.max(0, ...counts.map((item) => item.displayedCaseCount));
    return counts.map((item) => ({
      ...item,
      displayedIntensity: maximum > 0 ? item.displayedCaseCount / maximum : 0,
    }));
  }, [plotted, visibleConditions, showCountLabels, dashboard, displayMetric]);
  
  const metricUnavailable = markerData.some((row) => !Number.isSafeInteger(row.displayedCaseCount) || row.displayedCaseCount < 0);
  
  // Forward-compatible authoritative purok geometry. Only a validated GeoJSON
  // FeatureCollection of Polygon/MultiPolygon with barangay_id + purok is
  // rendered; invalid/absent data renders nothing (current behavior unchanged).
  const purokFeatures = validPurokGeoJson(purokLayer);
  
  const visibleMarkers = useMemo(() => {
    return showCountLabels && !supervisor
      ? markerData.filter((item) => item.displayedCaseCount > 0)
      : markerData;
  }, [markerData, showCountLabels, supervisor]);
  
  const centerPoint = hasValidCoordinates({ ...center, hasCoordinates: true })
    ? [Number(center.latitude), Number(center.longitude)]
    : points[0];

  const retry = controlled ? onRetry : load;

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading community health map" className={`${supervisor ? "supervisor-map-loading" : "animate-pulse rounded-xl border border-brand-border bg-brand-bg p-4"}`}>
        <div style={{ height: `${height}px` }} className="w-full rounded bg-slate-200/70" />
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2.5 w-24 rounded bg-slate-200/70" />
          <div className="h-2.5 w-16 rounded bg-slate-200/70" />
          <div className="h-2.5 w-16 rounded bg-slate-200/70" />
        </div>
      </div>
    );
  }

  if (errText) {
    if (supervisor) return dashboard
      ? <div className="hs-map-empty" style={{ height: `${height}px` }}><ErrorState compact title="Community health map unavailable" message={typeof errText === "string" ? errText : "Please try again."} onRetry={retry} /></div>
      : <ErrorState compact title="Community health map unavailable" message={typeof errText === "string" ? errText : "Please try again."} onRetry={retry} />;
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

  if (metricUnavailable) return dashboard
    ? <div className="hs-map-empty" style={{ height: `${height}px` }}><ErrorState compact title="Selected map metric unavailable" message="The selected metric did not contain a complete recorded count. No value has been substituted." onRetry={retry} /></div>
    : <ErrorState compact title="Selected map metric unavailable" message="The selected metric did not contain a complete recorded count. No value has been substituted." onRetry={retry} />;

  if (barangays.length === 0) {
    if (supervisor) return dashboard
      ? <div className="hs-map-empty" style={{ height: `${height}px` }}><EmptyState compact icon={MapPin} title="No available barangay data" description="No barangay records are available for your authorized scope and reporting period." /></div>
      : <EmptyState compact icon={MapPin} title="No available barangay data" description="No barangay records are available for your authorized scope and reporting period." />;
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
  const GeoJSONCompat = /** @type {any} */ (GeoJSON);
  const legend = mapLegend(metricLabel, visibleMarkers, boundaryFeatures.length > 0);

  return (
    <div className={supervisor ? `supervisor-health-map ${dashboard ? "hs-community-map" : ""}` : undefined}>
      {plotted.length === 0 ? (
        supervisor ? dashboard ? <div className="hs-map-empty" style={{ height: `${height}px` }}><EmptyState compact icon={MapPin} title="Recorded coordinates unavailable" description="The assigned barangay has no recorded reference point. No geographic location has been substituted." /></div> : <EmptyState compact icon={MapPin} title="Verified coordinates unavailable" description="The assigned barangay has no recorded reference point. No geographic location has been substituted." /> : <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
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
        <div className={`relative min-w-0 overflow-hidden border border-brand-border ${supervisor ? "rounded-card" : "rounded-xl"}`}>
<MapContainerCompat
            center={centerPoint}
            zoom={13}
            scrollWheelZoom={false}
            zoomControl={false}
            style={{ height: `${height}px`, width: "100%" }}
          >
            <IconFreeBasemap key={basemapVersion} onError={setBasemapError} />
            <ZoomControl position="bottomleft" />
            <FitToMarkers points={mapExtent} smooth={dashboard} reducedMotion={reducedMotion} />
            <InvalidateSize />
            <BoundaryAttribution visible={boundaryFeatures.length > 0} />
            <Pane name="barangay-boundaries" style={{ zIndex: 350 }}>
              {boundaryFeatures.map((feature) => {
                const row = markerData.find((item) => item.name === feature.properties.name);
                const selected = selectedName === row?.name;
                return <GeoJSONCompat key={feature.properties.name} data={feature}
                  style={{ color: selected ? '#2563A6' : '#739ABD', weight: selected ? 3 : 1, opacity: selected ? 1 : 0.65, fillColor: '#60A5FA', fillOpacity: selected ? 0.14 : 0.06 }}
                  eventHandlers={{ click: () => row && onSelect?.(row) }}>
                  <TooltipCompat direction="center" sticky>{feature.properties.name}</TooltipCompat>
                  {row && <PopupCompat><BarangayPopup barangay={row} dashboard={dashboard} metricLabel={metricLabel} periodLabel={periodLabel} detailsHref={detailsHref} /></PopupCompat>}
                </GeoJSONCompat>;
              })}
            </Pane>
            {purokFeatures && (
              <GeoJSONCompat
                data={purokFeatures}
                style={{
                  color: "#0B4A8F",
                  weight: 1.5,
                  opacity: 0.8,
                  fillColor: "#0B4A8F",
                  fillOpacity: 0.06,
                }}
              />
            )}
            {visibleMarkers.map((b) => {
              const caseCount = b.displayedCaseCount;
                const fillColor = dashboard
                  ? caseCount > 0 ? metricLabel.startsWith('Common Conditions') ? conditionColor(b.displayedConditions.find((item) => item.value > 0)?.name) : legend.color : '#8294A8'
                  : supervisor ? caseCount > 0 ? "#0B4A8F" : "#64748B" : intensityColor(b.displayedIntensity, caseCount);
              const isSelected = selectedName && b.name === selectedName;
              return (<React.Fragment key={b.id}>
                {dashboard && metricLabel.startsWith('Common Conditions') && b.displayedConditions.filter((item) => item.value > 0).map((condition, index, rows) => (
                  <CircleMarkerCompat key={condition.name} center={[b.latitude, b.longitude]} radius={Math.min(28, 13 + Math.sqrt(caseCount) * 1.2) + (rows.length - index) * 3}
                    pathOptions={{ color: conditionColor(condition.name), fill: false, weight: 3 }} eventHandlers={{ click: () => onSelect?.(b) }}>
                    <TooltipCompat>{condition.name}: {condition.value}</TooltipCompat>
                    <PopupCompat><BarangayPopup barangay={b} dashboard={dashboard} metricLabel={metricLabel} periodLabel={periodLabel} detailsHref={detailsHref} /></PopupCompat>
                  </CircleMarkerCompat>
                ))}
                <CircleMarkerCompat
                  key={b.id}
                  center={[b.latitude, b.longitude]}
                  radius={Math.min(28, 13 + Math.sqrt(caseCount) * 1.2 + (isSelected ? 3 : 0))}
                  pathOptions={{
                    color: fillColor,
                    fillColor,
                    fillOpacity: caseCount ? 0.7 : 0.4,
                    weight: isSelected ? 4 : dashboard ? 3 : 2,
                    className: dashboard ? "hs-map-marker" : undefined,
                  }}
                  eventHandlers={onSelect ? { click: () => onSelect(b) } : undefined}
                >
                  {showCountLabels && <TooltipCompat
                    permanent
                    direction={dashboard ? "right" : "center"}
                    offset={dashboard ? [10, 0] : [0, 0]}
                    className={`health-map-count-tooltip${dashboard ? " hs-map-place-label" : ""}`}
                    opacity={1}
                  >
                    <span style={{
                      color: dashboard ? "#163957" : supervisor || b.displayedIntensity >= 0.75 ? "#FFFFFF" : "#1F2937",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}>
                      {dashboard ? <><strong>{b.name}</strong><span>{caseCount.toLocaleString("en-PH")}</span></> : caseCount}
                    </span>
                  </TooltipCompat>}
<PopupCompat
                    autoPan
                    keepInView
                    autoPanPadding={[48, 48]}
                    offset={[0, -8]}
                    minWidth={200}
                    maxWidth={dashboard ? 260 : 300}
                    className="health-map-popup"
                  >
                    <BarangayPopup
                      barangay={b}
                      dashboard={dashboard}
                      onSelect={onSelect}
                      detailsHref={detailsHref}
                      metricLabel={metricLabel}
                      periodLabel={periodLabel}
                    />
                  </PopupCompat>
                </CircleMarkerCompat></React.Fragment>
              );
            })}
          </MapContainerCompat>
          {basemapError && (
            <div
              role="alert"
              className="absolute bottom-3 left-3 z-[500] rounded-lg border border-amber-300 bg-white/95 px-3 py-2 text-xs text-amber-900 shadow-sm"
            >
              Geographic basemap unavailable. Health markers remain visible. {basemapError}
              <button type="button" onClick={() => { setBasemapError(""); setBasemapVersion((version) => version + 1); }} className="ml-2 font-medium underline">Retry Basemap</button>
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

      {dashboard && plotted.length > 0 && <div className="hs-map-legend" role="group" aria-label={`${metricLabel} map legend`}>
        {legend.entries.map((entry) => <span key={entry.label}><i aria-hidden="true" style={{ background: entry.outline ? '#DBEAFE' : entry.color, borderColor: entry.color, borderRadius: entry.outline ? 2 : '50%' }} />{entry.label}</span>)}
      </div>}
      {dashboard && boundaryError && <p className="hs-map-boundary-note" role="status">{boundaryError}</p>}

      {/* Case-intensity legend + any barangays we could not plot (coordinates unavailable). */}
      {!dashboard && (supervisor ? <div className="mt-3 space-y-1 text-caption text-brand-gray"><p className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-brand-blue" /><span className="font-medium text-brand-ink">{metricLabel}</span> at a verified barangay reference point</p><p>Aggregated barangay data, not resident locations or clinical risk ratings.</p></div> : <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-gray">
        <span className="font-medium text-brand-ink">{metricLabel}: relative intensity</span>
        <span className="text-[11px]">Relative to the largest displayed count in scope; not a clinical risk rating.</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#94A3B8" }} /> No recorded count</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F6C453" }} /> Lower</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F59E0B" }} /> Moderate</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#EA580C" }} /> Elevated</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#B91C1C" }} /> Highest in scope</span>
      </div>)}
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-brand-gray">
          Coordinates unavailable (not plotted): {missing.map((b) => b.name).join(", ")}.
        </p>
      )}
    </div>
  );
}

/**
 * Compact popup card for one barangay — shows only the two essential metrics
 * (high-risk residents and recorded cases). Deeper statistics (reporting
 * period, condition breakdown, active cases) live on the barangay details page,
 * opened via `detailsHref` (or, when absent, via `onSelect` for consumers that
 * render their own detail panel). Values come from the live aggregate record.
 */
const BarangayPopup = React.memo(function BarangayPopup({ barangay: b, dashboard = false, onSelect, detailsHref, metricLabel, periodLabel }) {
  const count = dashboard ? b.caseCount : b.displayedCaseCount;
  const highRisk = dashboard ? b.highRiskResidents : b.reportingHighRiskResidents ?? b.highRiskResidents;
  return (
    <div className="health-map-popup-body">
      <h3 className="health-map-popup-title">{b.name}</h3>

      <dl className="health-map-popup-rows">
        <div className="health-map-popup-row">
          <dt>{dashboard ? 'Recorded cases' : metricLabel}</dt>
          <dd>{Number.isSafeInteger(count) ? count.toLocaleString("en-PH") : "—"}</dd>
        </div>
        <div className="health-map-popup-row">
          <dt>High-risk residents</dt>
          <dd>{Number.isSafeInteger(highRisk) ? highRisk.toLocaleString("en-PH") : "—"}</dd>
        </div>
        {Number.isSafeInteger(b.pendingFollowUps) && <div className="health-map-popup-row"><dt>Pending follow-ups</dt><dd>{b.pendingFollowUps.toLocaleString("en-PH")}</dd></div>}
        {metricLabel.startsWith("Common Conditions") && <div className="health-map-popup-row"><dt>{metricLabel}</dt><dd>{Number.isSafeInteger(b.displayedCaseCount) ? b.displayedCaseCount.toLocaleString("en-PH") : "—"}</dd></div>}
        {metricLabel.startsWith("Common Conditions") && b.displayedConditions?.filter((item) => item.value > 0).map((item) => <div className="health-map-popup-row" key={item.name}><dt>{item.name}</dt><dd>{item.value.toLocaleString('en-PH')}</dd></div>)}
      </dl>
      <p className="text-xs text-brand-gray">{periodLabel}</p>

      {detailsHref ? (
        <Link to={detailsHref} className="health-map-popup-action">
          View Barangay Details
        </Link>
      ) : onSelect && (
        <button type="button" onClick={() => onSelect(b)} className="health-map-popup-action">
          View Barangay Details
        </button>
      )}
    </div>
  );
});
