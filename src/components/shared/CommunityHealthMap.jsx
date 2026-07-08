import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, AlertTriangle, Stethoscope, Syringe, CalendarCheck, Activity } from "lucide-react";

const MAP_IMAGE = new URL("../../public/Background 1.png", import.meta.url).href;

const STATUS_COLOR = {
  "San Jose": "#28B463",
  "San Isidro": "#2A7DE1",
  "Old San Roque": "#E67E22",
};

export default function CommunityHealthMap({ barangays, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const [cardPos, setCardPos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    setCardPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const getBarangay = (name) => barangays.find((b) => b.name === name);

  return (
    <div className="relative">
      <div className="relative rounded-card overflow-hidden" style={{ background: "#E8F0F7" }}>
        <img
          src={MAP_IMAGE}
          alt="Municipality Health Map"
          className="w-full h-auto block"
          style={{ filter: "drop-shadow(0 8px 24px rgba(16,42,67,0.12))" }}
        />

        {/* Hotspot overlays */}
        {barangays.map((b) => {
          const color = STATUS_COLOR[b.name];
          return (
            <button
              key={b.name}
              onMouseEnter={() => setHovered(b.name)}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect && onSelect(b)}
              className="absolute -translate-x-1/2 -translate-y-1/2 group cursor-pointer"
              style={{ left: `${b.spot.x}%`, top: `${b.spot.y}%`, zIndex: hovered === b.name ? 15 : 5 }}
            >
              <span
                className="absolute inset-0 rounded-full animate-ping"
                style={{ backgroundColor: color, opacity: 0.35 }}
              />
              <span
                className="relative block rounded-full border-2 border-white shadow-lg transition-transform duration-200 group-hover:scale-150"
                style={{ backgroundColor: color, width: 18, height: 18 }}
              />
            </button>
          );
        })}

        {/* Floating hover card */}
        <AnimatePresence>
          {hovered && (() => {
            const b = getBarangay(hovered);
            if (!b) return null;
            const color = STATUS_COLOR[b.name];
            const left = cardPos.x > 260 ? cardPos.x - 232 : cardPos.x + 24;
            const top = cardPos.y > 220 ? cardPos.y - 180 : cardPos.y + 24;
            const stats = [
              { icon: Users, label: "Population", value: b.population.toLocaleString() },
              { icon: Stethoscope, label: "Consultations", value: b.consultations },
              { icon: AlertTriangle, label: "High-Risk Residents", value: b.highRisk },
              { icon: CalendarCheck, label: "Follow-up Completion", value: `${b.followUpCompletion}%` },
              { icon: Syringe, label: "Vaccination Coverage", value: `${b.vaccinationCoverage}%` },
            ];
            return (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.15 }}
                className="absolute z-20 pointer-events-none bg-white rounded-card shadow-float border border-brand-border p-4 w-56"
                style={{ left, top }}
              >
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-brand-border">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                  <p className="font-heading font-semibold text-brand-ink text-sm">{b.name}</p>
                </div>
                <div className="space-y-2.5">
                  {stats.map((s) => (
                    <div key={s.label} className="flex items-center justify-between text-xs">
                      <span className="text-brand-gray flex items-center gap-2">
                        <s.icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                        {s.label}
                      </span>
                      <span className="font-stat font-bold text-brand-ink">{s.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-2.5 border-t border-brand-border flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" style={{ color }} strokeWidth={1.8} />
                  <span className="text-xs font-medium" style={{ color }}>{b.healthStatus}</span>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4">
        {barangays.map((b) => (
          <div key={b.name} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLOR[b.name] }} />
            <span className="text-xs font-body font-medium text-brand-gray">{b.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 ml-auto text-xs text-brand-gray">
          <span className="inline-block w-2 h-2 rounded-full bg-brand-blue/40 animate-pulse" />
          Click a marker for details
        </div>
      </div>
    </div>
  );
}