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
  information: { label: "Information", color: "bg-brand-blue/10 text-brand-blue", icon: "Activity" },
  reminder: { label: "Reminder", color: "bg-brand-yellow/15 text-[#B07E00]", icon: "Clock" },
  alert: { label: "Alert", color: "bg-brand-danger/10 text-brand-danger", icon: "AlertTriangle" },
  success: { label: "Success", color: "bg-brand-green/10 text-brand-green", icon: "CheckCircle" },
  warning: { label: "Warning", color: "bg-brand-accent/10 text-brand-accent", icon: "ShieldAlert" },
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
