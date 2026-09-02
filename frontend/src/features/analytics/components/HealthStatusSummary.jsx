import React from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Activity, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";

const STATUS_ICON = {
  Healthy: ShieldCheck,
  Stable: Activity,
  "Needs Attention": AlertCircle,
};

const STATUS_BG = {
  Healthy: "bg-[#28B463]/10",
  Stable: "bg-[#2A7DE1]/10",
  "Needs Attention": "bg-[#E67E22]/10",
};

const STATUS_BORDER = {
  Healthy: "border-[#28B463]/20",
  Stable: "border-[#2A7DE1]/20",
  "Needs Attention": "border-[#E67E22]/20",
};

const STATUS_ICON_BG = {
  Healthy: "bg-[#28B463]/15 text-[#28B463]",
  Stable: "bg-[#2A7DE1]/15 text-[#2A7DE1]",
  "Needs Attention": "bg-[#E67E22]/15 text-[#E67E22]",
};

export default function HealthStatusSummary({ summary }) {
  return (
    <div className="grid sm:grid-cols-3 gap-5">
      {summary.map((s, i) => {
        const Icon = STATUS_ICON[s.status] || Activity;
        const TrendIcon = s.trendUp ? TrendingUp : TrendingDown;
        return (
          <motion.div
            key={s.status}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1, duration: 0.4 }}
            whileHover={{ y: -4 }}
            className={`rounded-card border p-6 ${STATUS_BG[s.status]} ${STATUS_BORDER[s.status]}`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${STATUS_ICON_BG[s.status]}`}>
                <Icon className="w-5 h-5" strokeWidth={1.8} />
              </div>
              <div className="flex items-center gap-1" style={{ color: s.color }}>
                <TrendIcon className="w-4 h-4" />
                <span className="text-sm font-body font-medium">{s.trend}</span>
              </div>
            </div>
            <p className="text-sm font-body font-medium text-brand-gray">{s.status}</p>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-3xl font-stat font-extrabold text-brand-ink">{s.residents.toLocaleString()}</span>
              <span className="text-sm text-brand-gray mb-1">residents</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-1.5 bg-white/60 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${s.percentage}%`, background: s.color }} />
              </div>
              <span className="text-xs font-stat font-bold text-brand-ink">{s.percentage}%</span>
            </div>
            <p className="text-xs text-brand-gray mt-3 leading-relaxed">{s.summary}</p>
          </motion.div>
        );
      })}
    </div>
  );
}