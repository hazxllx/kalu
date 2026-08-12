import React, { useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, Send } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";

const SUMMARY = [
  { icon: Activity, tone: "bg-brand-blue/10 text-brand-blue", label: "Consultations This Month", value: "312", change: "+8.2%", up: true },
  { icon: Send, tone: "bg-brand-yellow/15 text-[#B07E00]", label: "Referrals This Month", value: "24", change: "+3.1%", up: true },
  { icon: TrendingUp, tone: "bg-brand-green/10 text-brand-green", label: "Top Condition", value: "Hypertension", change: "342 cases", up: true },
  { icon: TrendingDown, tone: "bg-brand-danger/10 text-brand-danger", label: "High-Risk Residents", value: "47", change: "-2.1%", up: false },
];

const CONSULTATION_TRENDS = [
  { month: "Aug", consultations: 245, referrals: 18 }, { month: "Sep", consultations: 268, referrals: 22 },
  { month: "Oct", consultations: 254, referrals: 19 }, { month: "Nov", consultations: 289, referrals: 25 },
  { month: "Dec", consultations: 276, referrals: 21 }, { month: "Jan", consultations: 298, referrals: 23 },
  { month: "Feb", consultations: 312, referrals: 26 }, { month: "Mar", consultations: 305, referrals: 24 },
  { month: "Apr", consultations: 324, referrals: 28 }, { month: "May", consultations: 318, referrals: 25 },
  { month: "Jun", consultations: 335, referrals: 27 }, { month: "Jul", consultations: 312, referrals: 24 },
];

const DISEASE_DIST = [
  { name: "Hypertension", value: 342, color: "#0B5CAD" },
  { name: "Diabetes", value: 189, color: "#2A7DE1" },
  { name: "Respiratory", value: 156, color: "#F5B400" },
  { name: "Malnutrition", value: 98, color: "#28B463" },
  { name: "Anemia", value: 74, color: "#E74C3C" },
  { name: "Others", value: 120, color: "#5B6472" },
];

const BARANGAY_COMPARISON = [
  { barangay: "San Jose", consultations: 642, referrals: 38, highRisk: 12 },
  { barangay: "San Isidro", consultations: 528, referrals: 31, highRisk: 9 },
  { barangay: "Sta. Cruz", consultations: 489, referrals: 28, highRisk: 8 },
  { barangay: "San Antonio", consultations: 412, referrals: 24, highRisk: 7 },
  { barangay: "San Vicente", consultations: 386, referrals: 19, highRisk: 6 },
  { barangay: "Santo Nio", consultations: 345, referrals: 16, highRisk: 5 },
];

// Barangay Health Analytics Data
const REFERRAL_COMPLETION = [
  { barangay: "San Jose", rate: 82 },
  { barangay: "San Isidro", rate: 76 },
  { barangay: "Old San Roque", rate: 80 },
];

const MATERNAL_HEALTH_TREND = [
  { month: "Jan", sanJose: 45, sanIsidro: 38, oldSanRoque: 40 },
  { month: "Feb", sanJose: 52, sanIsidro: 41, oldSanRoque: 44 },
  { month: "Mar", sanJose: 48, sanIsidro: 44, oldSanRoque: 47 },
  { month: "Apr", sanJose: 55, sanIsidro: 46, oldSanRoque: 49 },
  { month: "May", sanJose: 50, sanIsidro: 42, oldSanRoque: 45 },
  { month: "Jun", sanJose: 58, sanIsidro: 49, oldSanRoque: 51 },
];

const CHILD_HEALTH_COVERAGE = [
  { barangay: "San Jose", services: 95 },
  { barangay: "San Isidro", services: 88 },
  { barangay: "Old San Roque", services: 84 },
];

const SENIOR_CITIZEN_TREND = [
  { month: "Jan", sanJose: 32, sanIsidro: 28, oldSanRoque: 29 },
  { month: "Feb", sanJose: 35, sanIsidro: 30, oldSanRoque: 31 },
  { month: "Mar", sanJose: 38, sanIsidro: 32, oldSanRoque: 33 },
  { month: "Apr", sanJose: 40, sanIsidro: 34, oldSanRoque: 35 },
  { month: "May", sanJose: 42, sanIsidro: 36, oldSanRoque: 37 },
  { month: "Jun", sanJose: 45, sanIsidro: 38, oldSanRoque: 39 },
];

const HEALTH_PROGRAM_PARTICIPATION = [
  { barangay: "San Jose", maternal: 85, immunization: 92, nutrition: 78, tb: 88, familyPlanning: 75 },
  { barangay: "San Isidro", maternal: 78, immunization: 85, nutrition: 72, tb: 82, familyPlanning: 68 },
  { barangay: "Old San Roque", maternal: 75, immunization: 83, nutrition: 70, tb: 79, familyPlanning: 67 },
];

const MONTHLY_CONSULTATIONS = [
  { month: "Jan", sanJose: 52, sanIsidro: 45, oldSanRoque: 42 },
  { month: "Feb", sanJose: 58, sanIsidro: 50, oldSanRoque: 46 },
  { month: "Mar", sanJose: 55, sanIsidro: 48, oldSanRoque: 44 },
  { month: "Apr", sanJose: 62, sanIsidro: 54, oldSanRoque: 49 },
  { month: "May", sanJose: 60, sanIsidro: 52, oldSanRoque: 47 },
  { month: "Jun", sanJose: 65, sanIsidro: 56, oldSanRoque: 52 },
];

const MONTHLY_REFERRALS = [
  { month: "Jan", sanJose: 8, sanIsidro: 6, oldSanRoque: 6 },
  { month: "Feb", sanJose: 9, sanIsidro: 7, oldSanRoque: 7 },
  { month: "Mar", sanJose: 10, sanIsidro: 8, oldSanRoque: 8 },
  { month: "Apr", sanJose: 11, sanIsidro: 9, oldSanRoque: 9 },
  { month: "May", sanJose: 12, sanIsidro: 10, oldSanRoque: 10 },
  { month: "Jun", sanJose: 13, sanIsidro: 11, oldSanRoque: 11 },
];

const RISK_DISTRIBUTION = [
  { name: "Low Risk", value: 45, color: "#28B463" },
  { name: "Moderate Risk", value: 30, color: "#0B5CAD" },
  { name: "High Risk", value: 18, color: "#F5B400" },
  { name: "Critical", value: 7, color: "#E74C3C" },
];

const DISEASES_BY_BARANGAY = [
  { barangay: "San Jose", hypertension: 85, diabetes: 52, respiratory: 38, malnutrition: 22, anemia: 18 },
  { barangay: "San Isidro", hypertension: 72, diabetes: 45, respiratory: 32, malnutrition: 18, anemia: 15 },
  { barangay: "Old San Roque", hypertension: 70, diabetes: 43, respiratory: 30, malnutrition: 17, anemia: 14 },
];

const PROGRAM_COMPLIANCE = [
  { program: "Prenatal", rate: 82 },
  { program: "Immunization", rate: 89 },
  { program: "Nutrition", rate: 76 },
  { program: "TB", rate: 84 },
  { program: "Family Planning", rate: 71 },
];

const tooltipStyle = { fontSize: "12px", borderRadius: "8px", border: "1px solid #E5EAF1" };

export default function HealthTrends() {
  const [period, setPeriod] = useState("12m");

  return (
    <>
      <PageHeader
        crumbs={["Home", "Health Trends"]}
        title="Health Trends"
        subtitle="Municipal health overview across all barangays"
        action={
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue">
            <option value="3m">Last 3 Months</option>
            <option value="6m">Last 6 Months</option>
            <option value="12m">Last 12 Months</option>
          </select>
        }
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {SUMMARY.map((s, i) => (
          <div key={s.label} className="bg-white rounded-card border border-brand-border shadow-card p-5">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${s.tone}`}>
              <s.icon className="w-5 h-5" strokeWidth={1.8} />
            </div>
            <p className="mt-4 text-xs text-brand-gray uppercase tracking-wide">{s.label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className="text-2xl font-stat font-bold text-brand-ink">{s.value}</p>
              <span className={`text-xs font-medium ${s.up ? "text-brand-green" : "text-brand-danger"} flex items-center gap-0.5`}>
                {s.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />} {s.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Community Health Overview */}
      <Card className="p-4 sm:p-6 mt-6">
        <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-1">Community Health Overview</h3>
        <p className="text-xs text-brand-gray mb-4">Hover over highlighted barangays for quick statistics. Click to view detailed analytics.</p>
        
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Map Section */}
          <div className="lg:col-span-2">
            <div className="flex justify-center">
              <img
                src="/Background 1.png"
                alt="Community Health Map"
                className="w-full max-h-[420px] sm:max-h-[460px] object-contain"
              />
            </div>
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-brand-gray">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-brand-green"></span>
                <span>San Jose</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-brand-blue"></span>
                <span>San Isidro</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-brand-accent"></span>
                <span>Old San Roque</span>
              </div>
            </div>
          </div>

          {/* Barangay Summary Cards */}
          <div className="space-y-3">
            <div className="bg-brand-light/30 rounded-lg p-4 border border-brand-border">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-green"></span>
                  <span className="font-medium text-brand-ink text-sm">San Jose</span>
                </div>
                <span className="text-xs font-medium text-brand-green bg-brand-green/10 px-2 py-0.5 rounded-full">Healthy</span>
              </div>
              <p className="mt-2 text-xs text-brand-gray">4,215 residents</p>
              <p className="text-xs text-brand-gray">168 consultations</p>
            </div>

            <div className="bg-brand-light/30 rounded-lg p-4 border border-brand-border">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-blue"></span>
                  <span className="font-medium text-brand-ink text-sm">San Isidro</span>
                </div>
                <span className="text-xs font-medium text-brand-blue bg-brand-blue/10 px-2 py-0.5 rounded-full">Stable</span>
              </div>
              <p className="mt-2 text-xs text-brand-gray">3,486 residents</p>
              <p className="text-xs text-brand-gray">142 consultations</p>
            </div>

            <div className="bg-brand-light/30 rounded-lg p-4 border border-brand-border">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-accent"></span>
                  <span className="font-medium text-brand-ink text-sm">Old San Roque</span>
                </div>
                <span className="text-xs font-medium text-brand-accent bg-brand-accent/10 px-2 py-0.5 rounded-full">Needs Attention</span>
              </div>
              <p className="mt-2 text-xs text-brand-gray">5,144 residents</p>
              <p className="text-xs text-brand-gray">213 consultations</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Summary Status Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mt-6">
        <div className="bg-white rounded-card border border-brand-border shadow-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-brand-green"></span>
            <h4 className="font-semibold text-brand-ink text-sm">Healthy</h4>
          </div>
          <p className="text-2xl font-stat font-bold text-brand-ink">4,215</p>
          <p className="text-xs text-brand-gray mt-1">residents</p>
          <p className="text-lg font-bold text-brand-green mt-2">33%</p>
          <p className="text-xs text-brand-gray mt-3 leading-relaxed">All health indicators within normal range. Consistent follow-up compliance and high vaccination coverage.</p>
        </div>

        <div className="bg-white rounded-card border border-brand-border shadow-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-brand-blue"></span>
            <h4 className="font-semibold text-brand-ink text-sm">Stable</h4>
          </div>
          <p className="text-2xl font-stat font-bold text-brand-ink">3,486</p>
          <p className="text-xs text-brand-gray mt-1">residents</p>
          <p className="text-lg font-bold text-brand-blue mt-2">27%</p>
          <p className="text-xs text-brand-gray mt-3 leading-relaxed">Most indicators remain stable with minor fluctuations. Follow-up completion remains consistent.</p>
        </div>

        <div className="bg-white rounded-card border border-brand-border shadow-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-brand-accent"></span>
            <h4 className="font-semibold text-brand-ink text-sm">Needs Attention</h4>
          </div>
          <p className="text-2xl font-stat font-bold text-brand-ink">5,144</p>
          <p className="text-xs text-brand-gray mt-1">residents</p>
          <p className="text-lg font-bold text-brand-accent mt-2">40%</p>
          <p className="text-xs text-brand-gray mt-3 leading-relaxed">Higher risk indicators detected. Increased hypertension and diabetes cases require monitoring.</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mt-6">
        <Card className="lg:col-span-2 p-6">
          <h3 className="font-semibold text-brand-ink mb-1">Consultation & Referral Trends</h3>
          <p className="text-xs text-brand-gray mb-4">Monthly count over the past 12 months</p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={CONSULTATION_TRENDS} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="consultations" name="Consultations" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="referrals" name="Referrals" stroke="#F5B400" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-1">Disease Distribution</h3>
          <p className="text-xs text-brand-gray mb-4">Top reported conditions</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={DISEASE_DIST} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                {DISEASE_DIST.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {DISEASE_DIST.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                <span className="flex-1 text-brand-ink">{d.name}</span>
                <span className="text-brand-gray font-stat font-bold">{d.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mt-5">
        <Card className="lg:col-span-2 p-6">
          <h3 className="font-semibold text-brand-ink mb-1">Monthly Consultation Count by Barangay</h3>
          <p className="text-xs text-brand-gray mb-4">Comparison across 6 barangays</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={BARANGAY_COMPARISON} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
              <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
              <Bar dataKey="consultations" name="Consultations" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4">Barangay Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border text-left">
                  <th className="pb-2 text-xs font-medium text-brand-gray uppercase">Barangay</th>
                  <th className="pb-2 text-xs font-medium text-brand-gray text-right">Consult.</th>
                  <th className="pb-2 text-xs font-medium text-brand-gray text-right">Referrals</th>
                  <th className="pb-2 text-xs font-medium text-brand-gray text-right">Risk</th>
                </tr>
              </thead>
              <tbody>
                {BARANGAY_COMPARISON.map((b) => (
                  <tr key={b.barangay} className="border-b border-brand-border last:border-0">
                    <td className="py-2.5 text-sm font-medium text-brand-ink">{b.barangay}</td>
                    <td className="py-2.5 text-right text-sm font-stat font-bold text-brand-ink">{b.consultations}</td>
                    <td className="py-2.5 text-right text-sm text-brand-gray">{b.referrals}</td>
                    <td className="py-2.5 text-right text-sm text-brand-danger font-medium">{b.highRisk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Barangay Health Analytics */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold text-brand-ink mb-2">Barangay Health Analytics</h2>
        <p className="text-sm text-brand-gray mb-6">Comparative health statistics submitted by every barangay</p>

        <div className="grid sm:grid-cols-2 gap-5">
          {/* Chart 1: Referral Completion Rate */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Referral Completion Rate per Barangay</h3>
            <p className="text-xs text-brand-gray mb-4">Efficiency of resident referral completion</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={REFERRAL_COMPLETION} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Bar dataKey="rate" name="Completion Rate (%)" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 2: Maternal Health Services Trend */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Maternal Health Services Trend</h3>
            <p className="text-xs text-brand-gray mb-4">Monthly prenatal services by barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={MATERNAL_HEALTH_TREND} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="sanJose" name="San Jose" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="sanIsidro" name="San Isidro" stroke="#2A7DE1" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="oldSanRoque" name="Old San Roque" stroke="#E74C3C" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 3: Child Health Services Coverage */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Child Health Services Coverage</h3>
            <p className="text-xs text-brand-gray mb-4">Completed child health services per barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={CHILD_HEALTH_COVERAGE} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Bar dataKey="services" name="Services" fill="#28B463" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 4: Senior Citizen Monitoring Trend */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Senior Citizen Monitoring Trend</h3>
            <p className="text-xs text-brand-gray mb-4">Monthly monitoring records by barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={SENIOR_CITIZEN_TREND} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="sanJose" name="San Jose" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="sanIsidro" name="San Isidro" stroke="#2A7DE1" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="oldSanRoque" name="Old San Roque" stroke="#E74C3C" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 5: Health Program Participation */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Health Program Participation</h3>
            <p className="text-xs text-brand-gray mb-4">Program participation across barangays</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={HEALTH_PROGRAM_PARTICIPATION} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="maternal" name="Maternal Care" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="immunization" name="Immunization" fill="#28B463" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="nutrition" name="Nutrition" fill="#F5B400" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="tb" name="TB Monitoring" fill="#E74C3C" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="familyPlanning" name="Family Planning" fill="#5B6472" radius={[4, 4, 0, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 6: Monthly Consultations Submitted */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Monthly Consultations Submitted</h3>
            <p className="text-xs text-brand-gray mb-4">Consultations submitted by each barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={MONTHLY_CONSULTATIONS} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sanJose" name="San Jose" fill="#0B5CAD" stackId="a" barSize={20} />
                <Bar dataKey="sanIsidro" name="San Isidro" fill="#2A7DE1" stackId="a" barSize={20} />
                <Bar dataKey="oldSanRoque" name="Old San Roque" fill="#E74C3C" stackId="a" barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 7: Monthly Referrals Submitted */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Monthly Referrals Submitted</h3>
            <p className="text-xs text-brand-gray mb-4">Referrals created by each barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={MONTHLY_REFERRALS} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sanJose" name="San Jose" fill="#0B5CAD" stackId="a" barSize={20} />
                <Bar dataKey="sanIsidro" name="San Isidro" fill="#2A7DE1" stackId="a" barSize={20} />
                <Bar dataKey="oldSanRoque" name="Old San Roque" fill="#E74C3C" stackId="a" barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 8: Risk Classification Distribution */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Risk Classification Distribution</h3>
            <p className="text-xs text-brand-gray mb-4">Municipality-wide resident risk levels</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={RISK_DISTRIBUTION} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {RISK_DISTRIBUTION.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 9: Top Reported Diseases by Barangay */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Top Reported Diseases by Barangay</h3>
            <p className="text-xs text-brand-gray mb-4">Disease prevalence across barangays</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={DISEASES_BY_BARANGAY} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="hypertension" name="Hypertension" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="diabetes" name="Diabetes" fill="#2A7DE1" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="respiratory" name="Respiratory" fill="#F5B400" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="malnutrition" name="Malnutrition" fill="#28B463" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="anemia" name="Anemia" fill="#E74C3C" radius={[4, 4, 0, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart 10: Health Program Compliance */}
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Health Program Compliance</h3>
            <p className="text-xs text-brand-gray mb-4">Municipality-wide program completion percentages</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={PROGRAM_COMPLIANCE} layout="vertical" margin={{ top: 5, right: 10, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis dataKey="program" type="category" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={false} tickLine={false} width={75} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Bar dataKey="rate" name="Completion Rate (%)" fill="#0B5CAD" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>
    </>
  );
}