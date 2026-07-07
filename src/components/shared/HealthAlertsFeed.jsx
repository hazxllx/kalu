import React from "react";
import { motion } from "framer-motion";
import Icon from "@/components/shared/Icon";

const LEVEL_COLOR = {
  warning: { bg: "bg-brand-yellow/15 text-[#B07E00]", dot: "bg-brand-yellow" },
  success: { bg: "bg-brand-green/10 text-brand-green", dot: "bg-brand-green" },
  info: { bg: "bg-brand-blue/10 text-brand-blue", dot: "bg-brand-blue" },
};

export default function HealthAlertsFeed({ alerts }) {
  return (
    <div className="bg-white rounded-card border border-brand-border shadow-card p-6">
      <div className="relative pl-2">
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-brand-border" />
        <div className="space-y-5">
          {alerts.map((alert, i) => {
            const tone = LEVEL_COLOR[alert.level] || LEVEL_COLOR.info;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="relative flex items-start gap-4"
              >
                <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${tone.bg} ring-4 ring-white`}>
                  <Icon name={alert.icon} className="w-4 h-4" strokeWidth={1.8} />
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="text-sm font-body text-brand-ink">{alert.msg}</p>
                  <p className="text-xs text-brand-gray mt-0.5">{alert.time}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}