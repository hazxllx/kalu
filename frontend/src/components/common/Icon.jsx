import React from "react";
import {
  Activity, HeartPulse, Home, FileHeart, CalendarClock, RefreshCw, Stethoscope,
  Syringe, Baby, Blocks, Accessibility, HeartHandshake, Smile, FileText, UserPlus,
  ClipboardList, CalendarCheck, CalendarDays, Bell, Settings, LayoutDashboard, Users,
  BarChart3, Send, Map, Shield, KeyRound, ScrollText, Terminal, AlertTriangle, Database,
  ShieldCheck, ShieldAlert, Megaphone, TrendingUp, TrendingDown, AlertCircle,
  User, LifeBuoy, Lock, Building2, Siren, UserCog, Server,
} from "lucide-react";

const MAP = {
  Activity, HeartPulse, Home, FileHeart, CalendarClock, RefreshCw, Stethoscope,
  Syringe, Baby, Blocks, Accessibility, HeartHandshake, Smile, FileText, UserPlus,
  ClipboardList, CalendarCheck, CalendarDays, Bell, Settings, LayoutDashboard, Users,
  BarChart3, Send, Map, Shield, KeyRound, ScrollText, Terminal, AlertTriangle, Database,
  ShieldCheck, ShieldAlert, Megaphone, TrendingUp, TrendingDown, AlertCircle,
  User, LifeBuoy, Lock, Building2, Siren, UserCog, Server,
};

export default function Icon({ name, ...props }) {
  const Cmp = MAP[name] || Activity;
  return <Cmp {...props} />;
}