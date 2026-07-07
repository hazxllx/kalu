import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Users, Home, Stethoscope, CalendarCheck, CalendarClock, AlertTriangle, Send, HeartPulse, Bell, Activity, UserRound } from "lucide-react";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const tooltipStyle = { borderRadius: 12, border: "1px solid #E5EAF1", fontSize: 12, fontFamily: "DM Sans" };
const tickStyle = { fill: "#5B6472", fontSize: 11, fontFamily: "DM Sans" };

const alertDotColor = {
  warning: "bg-brand-yellow",
  success: "bg-brand-green",
  info: "bg-brand-blue",
};

const programColor = (coverage) => coverage >= 85 ? "#28B463" : coverage >= 75 ? "#2A7DE1" : "#E67E22";

export default function BarangaySidePanel({ barangay, onClose }) {
  if (!barangay) return null;
  const p = barangay.panel;
  const color = barangay.color;

  const infoItems = [
    { icon: Users, label: "Population", value: barangay.population.toLocaleString() },
    { icon: Home, label: "Households", value: barangay.households.toLocaleString() },
    { icon: UserRound, label: "Assigned Midwife", value: barangay.assignedMidwife },
    { icon: Users, label: "Assigned BHWs", value: barangay.assignedBHWs },
    { icon: Stethoscope, label: "Consultations (Month)", value: barangay.consultations },
    { icon: CalendarCheck, label: "Completed Follow-ups", value: barangay.completedFollowUps },
    { icon: CalendarClock, label: "Pending Follow-ups", value: barangay.pendingFollowUps },
    { icon: AlertTriangle, label: "High-Risk Residents", value: barangay.highRisk },
  ];

  const referralItems = [
    { label: "Pending", value: p.referrals.pending, color: "bg-brand-yellow" },
    { label: "Accepted", value: p.referrals.accepted, color: "bg-brand-green" },
    { label: "Completed", value: p.referrals.completed, color: "bg-brand-blue" },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex justify-end"
      >
        <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="relative w-full max-w-md bg-brand-bg h-full overflow-y-auto shadow-float"
        >
          {/* Header */}
          <div className="gradient-hero p-6 text-white sticky top-0 z-10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/70 font-body">Barangay</p>
                <h2 className="text-2xl font-heading font-semibold">{barangay.name}</h2>
              </div>
              <button onClick={onClose} className="w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              <StatusBadge value={barangay.healthStatus} />
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* Barangay Information */}
            <Card className="p-5">
              <h3 className="font-heading font-semibold text-brand-ink mb-4 text-sm">Barangay Information</h3>
              <div className="grid grid-cols-2 gap-4">
                {infoItems.map((item) => (
                  <div key={item.label}>
                    <div className="flex items-center gap-2 text-brand-gray mb-1">
                      <item.icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                      <span className="text-xs">{item.label}</span>
                    </div>
                    <p className="font-stat font-bold text-brand-ink text-lg">{item.value}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Monthly Consultations */}
            <Card className="p-5">
              <h3 className="font-heading font-semibold text-brand-ink mb-4 text-sm">Monthly Consultations</h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={p.monthlyConsultations}>
                  <CartesianGrid vertical={false} stroke="#E5EAF1" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
                  <YAxis axisLine={false} tickLine={false} tick={tickStyle} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            {/* Disease Trends */}
            <Card className="p-5">
              <h3 className="font-heading font-semibold text-brand-ink mb-4 text-sm">Disease Trends</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={p.diseaseTrends} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid horizontal={false} stroke="#E5EAF1" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={tickStyle} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={80} tick={tickStyle} />
                  <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
                  <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Vaccination & Follow-up */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-5">
                <h3 className="font-heading font-semibold text-brand-ink mb-3 text-sm">Vaccination</h3>
                <p className="text-3xl font-stat font-bold" style={{ color }}>{barangay.vaccinationCoverage}%</p>
                <div className="mt-2 h-2 bg-brand-border rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${barangay.vaccinationCoverage}%`, background: color }} />
                </div>
              </Card>
              <Card className="p-5">
                <h3 className="font-heading font-semibold text-brand-ink mb-3 text-sm">Follow-up Rate</h3>
                <p className="text-3xl font-stat font-bold" style={{ color }}>{barangay.followUpCompletion}%</p>
                <div className="mt-2 h-2 bg-brand-border rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${barangay.followUpCompletion}%`, background: color }} />
                </div>
              </Card>
            </div>

            {/* Referral Statistics */}
            <Card className="p-5">
              <h3 className="font-heading font-semibold text-brand-ink mb-4 text-sm flex items-center gap-2">
                <Send className="w-4 h-4 text-brand-accent" /> Referral Statistics
              </h3>
              <div className="space-y-3">
                {referralItems.map((r) => (
                  <div key={r.label}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-brand-gray">{r.label}</span>
                      <span className="font-stat font-bold text-brand-ink">{r.value}</span>
                    </div>
                    <div className="h-2 bg-brand-border rounded-full overflow-hidden">
                      <div className={`h-full ${r.color} rounded-full`} style={{ width: `${r.value * 5}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Health Programs */}
            <Card className="p-5">
              <h3 className="font-heading font-semibold text-brand-ink mb-4 text-sm flex items-center gap-2">
                <HeartPulse className="w-4 h-4 text-brand-blue" /> Health Programs
              </h3>
              <div className="space-y-3">
                {p.healthPrograms.map((prog) => (
                  <div key={prog.name} className="flex items-center justify-between border-b border-brand-border pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-body font-medium text-brand-ink">{prog.name}</p>
                      <p className="text-xs text-brand-gray">{prog.enrolled} enrolled</p>
                    </div>
                    <span className="text-sm font-stat font-bold" style={{ color: programColor(prog.coverage) }}>{prog.coverage}%</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Recent Health Alerts */}
            <Card className="p-5">
              <h3 className="font-heading font-semibold text-brand-ink mb-4 text-sm flex items-center gap-2">
                <Bell className="w-4 h-4 text-brand-danger" /> Recent Health Alerts
              </h3>
              <div className="space-y-3">
                {p.recentAlerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${alertDotColor[alert.level]}`} />
                    <div className="flex-1">
                      <p className="text-sm text-brand-ink">{alert.msg}</p>
                      <p className="text-xs text-brand-gray mt-0.5">{alert.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Monthly Summary */}
            <Card className="p-5">
              <h3 className="font-heading font-semibold text-brand-ink mb-4 text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-brand-accent" /> Monthly Summary
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={p.monthlySummary}>
                  <CartesianGrid vertical={false} stroke="#E5EAF1" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
                  <YAxis axisLine={false} tickLine={false} tick={tickStyle} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="consultations" fill="#0B5CAD" radius={[4, 4, 0, 0]} maxBarSize={12} />
                  <Bar dataKey="followUps" fill="#2A7DE1" radius={[4, 4, 0, 0]} maxBarSize={12} />
                  <Bar dataKey="vaccinations" fill="#28B463" radius={[4, 4, 0, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}