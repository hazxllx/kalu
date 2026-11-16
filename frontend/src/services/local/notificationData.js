/**
 * Local (non-demo) notification datasets.
 *
 * This module carries no demo data. Every role's notification list starts empty
 * and the dashboard shell shows an empty/loading state until the backend
 * supplies real notifications for the signed-in role. The role keys, `ICONS`
 * and `CATEGORIES` are configuration maps (not records) and are preserved so
 * existing consumers keep compiling and never read `undefined`.
 */

import { CheckCircle, AlertTriangle, CalendarClock, FileCheck, UserPlus, ShieldAlert, Activity, Send, Clock, ShieldCheck, Database, Lock, Baby, Syringe, FileText, TrendingUp } from "lucide-react";

const ICONS = { CheckCircle, AlertTriangle, CalendarClock, FileCheck, UserPlus, ShieldAlert, Activity, Send, Clock, ShieldCheck, Database, Lock, Baby, Syringe, FileText, TrendingUp };

const CATEGORIES = {
  information: { label: "Information", color: "bg-blue-50 text-[#2563EB] dark:bg-blue-500/15 dark:text-blue-300", icon: "Activity" },
  reminder: { label: "Reminder", color: "bg-violet-50 text-[#7C3AED] dark:bg-violet-500/15 dark:text-violet-300", icon: "Clock" },
  alert: { label: "Alert", color: "bg-rose-50 text-[#DC2626] dark:bg-rose-500/15 dark:text-rose-300", icon: "AlertTriangle" },
  success: { label: "Success", color: "bg-emerald-50 text-[#059669] dark:bg-emerald-500/15 dark:text-emerald-300", icon: "CheckCircle" },
  warning: { label: "Warning", color: "bg-amber-50 text-[#D97706] dark:bg-amber-400/15 dark:text-amber-200", icon: "ShieldAlert" },
};

export const NOTIFICATIONS = {
  "resident-limited": [],
  resident: [],
  bhw: [],
  midwife: [],
  rhu: [],
  phn: [],
  mho: [],
  admin: [],
};

export { ICONS, CATEGORIES };
