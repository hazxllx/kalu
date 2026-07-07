import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import { CalendarClock, Syringe, AlertTriangle, Send, Activity, Bell } from "lucide-react";

const ICONS = { CalendarClock, Syringe, AlertTriangle, Send, Activity, Bell };
const TONES = {
  accent: "bg-brand-accent/10 text-brand-accent",
  green: "bg-brand-green/10 text-brand-green",
  yellow: "bg-brand-yellow/15 text-[#B07E00]",
  danger: "bg-brand-danger/10 text-brand-danger",
  blue: "bg-brand-blue/10 text-brand-blue",
};

const DEFAULT = [
  { icon: "CalendarClock", title: "Upcoming Consultation", desc: "3 patients scheduled for consultation tomorrow.", time: "1h ago", tone: "accent" },
  { icon: "Syringe", title: "Scheduled Immunization", desc: "Child immunization session on July 14, 1:00 PM.", time: "4h ago", tone: "green" },
  { icon: "AlertTriangle", title: "High Risk Alert", desc: "Ana Villanueva flagged as high-risk pregnancy.", time: "1d ago", tone: "danger" },
  { icon: "Send", title: "Referral Update", desc: "Referral to RHU Pili was accepted.", time: "2d ago", tone: "blue" },
  { icon: "Activity", title: "Health Program Activity", desc: "Nutrition counseling every Tuesday at 9:00 AM.", time: "3d ago", tone: "yellow" },
];

export default function NotificationsPage({ crumbs = ["Home", "Notifications"], items = DEFAULT }) {
  return (
    <>
      <PageHeader crumbs={crumbs} title="Notifications" subtitle="Stay updated on reminders, alerts, and advisories." />
      <div className="space-y-3 max-w-3xl">
        {items.map((n, i) => {
          const I = ICONS[n.icon] || Bell;
          return (
            <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className="p-4 flex gap-4 items-start hover:shadow-soft transition-shadow">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${TONES[n.tone]}`}><I className="w-5 h-5" strokeWidth={1.8} /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-brand-ink">{n.title}</p>
                    <span className="text-xs text-brand-gray whitespace-nowrap">{n.time}</span>
                  </div>
                  <p className="text-sm text-brand-gray mt-0.5">{n.desc}</p>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}