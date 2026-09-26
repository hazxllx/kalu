import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { RefreshCw, MapPin } from "lucide-react";

import { fetchCommunityMap } from "@/services/api/earlyWarningApi";

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
}) {
  const controlled = Array.isArray(barangaysProp);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!controlled);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchCommunityMap()
      .then((res) => setData(res))
      .catch(() => setError("Unable to load community health data."))
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

  const plotted = useMemo(() => barangays.filter((b) => b.hasCoordinates), [barangays]);
  const missing = useMemo(() => barangays.filter((b) => !b.hasCoordinates), [barangays]);
  const points = useMemo(() => plotted.map((b) => [b.latitude, b.longitude]), [plotted]);
  const centerPoint = center ? [center.latitude, center.longitude] : points[0] || PILI_CENTER;

  const retry = controlled ? onRetry : load;

  if (isLoading) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl border border-brand-border bg-brand-bg">
        <p className="text-sm text-brand-gray">Loading community health map…</p>
      </div>
    );
  }

  if (errText) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-brand-danger/25 bg-brand-danger/5">
        <p className="text-sm font-medium text-brand-danger">{errText}</p>
        {retry && (
          <button
            onClick={retry}
            className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        )}
      </div>
    );
  }

  if (barangays.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl border border-brand-border bg-brand-bg">
        <p className="text-sm text-brand-gray">No barangays are available for your scope.</p>
      </div>
    );
  }

  return (
    <div>
      {plotted.length === 0 ? (
        <div className="flex h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-bg text-center">
          <MapPin className="h-6 w-6 text-brand-gray" strokeWidth={1.6} />
          <p className="text-sm font-medium text-brand-ink">No geographic data available.</p>
          <p className="max-w-sm text-xs text-brand-gray">
            None of the barangays in your scope have verified map coordinates yet.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-brand-border">
          <MapContainer
            center={centerPoint}
            zoom={13}
            scrollWheelZoom={false}
            style={{ height: "420px", width: "100%" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitToMarkers points={points} />
            {plotted.map((b) => {
              const caseCount = b.caseCount ?? 0;
              const color = intensityColor(b.intensity ?? 0, caseCount);
              const isSelected = selectedName && b.name === selectedName;
              return (
                <CircleMarker
                  key={b.id}
                  center={[b.latitude, b.longitude]}
                  radius={isSelected ? 16 : 12}
                  pathOptions={{
                    color: isSelected ? "#1D4ED8" : color,
                    fillColor: color,
                    fillOpacity: caseCount ? 0.7 : 0.4,
                    weight: isSelected ? 4 : 2,
                  }}
                  eventHandlers={onSelect ? { click: () => onSelect(b) } : undefined}
                >
                  <Popup>
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
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      )}

      {/* Heatmap legend + any barangays we could not plot (coordinates unavailable). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-gray">
        <span className="font-medium text-brand-ink">Case intensity:</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#94A3B8" }} /> No data</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F59E0B" }} /> Lower</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#B91C1C" }} /> Higher</span>
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-brand-gray">
          Coordinates unavailable (not plotted): {missing.map((b) => b.name).join(", ")}.
        </p>
      )}
    </div>
  );
}
