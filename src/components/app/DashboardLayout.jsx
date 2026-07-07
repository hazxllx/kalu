import React, { useState, useRef, useEffect } from "react";
import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Bell, Menu, X, LogOut, ChevronDown, User, Settings,
  LifeBuoy, ShieldCheck, ShieldAlert,
} from "lucide-react";
import Icon from "@/components/shared/Icon";
import VerificationBadge from "@/components/shared/VerificationBadge";
import { LOGO_URL, ROLES } from "@/lib/brand";
import { NAV } from "@/lib/navConfig";

export default function DashboardLayout({ roleKey }) {
  const role = ROLES[roleKey];
  const items = NAV[roleKey] || [];
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const isResident = roleKey === "resident";
  const verified = isResident; // demo: resident shows verified

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const settingsPath = `/${roleKey === "rhu" ? "app/rhu" : `app/${roleKey}`}/settings`;
  const profilePath = `${location.pathname.split("/").slice(0, 4).join("/")}/profile`;

  const NavList = () => (
    <nav className="px-3 space-y-1">
      {items.map((it) => {
        const active = location.pathname === it.path;
        return (
          <Link
            key={it.path}
            to={it.path}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm transition-colors ${
              active
                ? "bg-brand-light text-brand-blue font-medium"
                : "text-brand-gray hover:bg-slate-50 hover:text-brand-ink"
            }`}
          >
            <Icon name={it.icon} className="w-[18px] h-[18px]" strokeWidth={1.8} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-white border-r border-brand-border">
        <div className="h-16 flex items-center px-5 border-b border-brand-border">
          <img src={LOGO_URL} alt="KALUSAGAP" className="h-16 w-auto" />
        </div>
        <div className="flex-1 overflow-y-auto py-5 no-scrollbar"><NavList /></div>
        <div className="p-3 border-t border-brand-border">
          <button onClick={() => navigate("/login")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm text-brand-gray hover:bg-slate-50">
            <LogOut className="w-[18px] h-[18px]" strokeWidth={1.8} /> Log out
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)} className="fixed inset-0 bg-black/30 z-40 lg:hidden" />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: "spring", damping: 26, stiffness: 240 }}
              className="fixed inset-y-0 left-0 w-64 bg-white z-50 lg:hidden flex flex-col">
              <div className="h-24 flex items-center justify-between px-5 border-b border-brand-border">
                <img src={LOGO_URL} alt="KALUSAGAP" className="h-16 w-auto" />
                <button onClick={() => setOpen(false)}><X className="w-5 h-5 text-brand-gray" /></button>
              </div>
              <div className="flex-1 overflow-y-auto py-5"><NavList /></div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/90 backdrop-blur border-b border-brand-border flex items-center gap-3 px-4 md:px-6">
          <button onClick={() => setOpen(true)} className="lg:hidden text-brand-gray"><Menu className="w-6 h-6" /></button>
          <div className="hidden md:flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 w-72">
            <Search className="w-4 h-4 text-brand-gray" />
            <input placeholder="Search residents, records..." className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70" />
          </div>
          <div className="ml-auto flex items-center gap-2 md:gap-4">
            <button className="relative w-10 h-10 rounded-btn hover:bg-slate-50 flex items-center justify-center">
              <Bell className="w-5 h-5 text-brand-gray" strokeWidth={1.8} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-brand-danger rounded-full" />
            </button>
            <div ref={menuRef} className="relative flex items-center gap-2 pl-2 md:pl-3 md:border-l border-brand-border">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 rounded-btn hover:bg-slate-50 px-2 py-1.5 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-brand-blue text-white flex items-center justify-center text-sm font-semibold font-heading">
                  {role.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </div>
                <div className="hidden md:block text-left">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-brand-ink leading-tight">{role.name}</p>
                    {isResident && (
                      verified
                        ? <ShieldCheck className="w-3.5 h-3.5 text-brand-green" strokeWidth={2} />
                        : <ShieldAlert className="w-3.5 h-3.5 text-brand-yellow" strokeWidth={2} />
                    )}
                  </div>
                  <p className="text-xs text-brand-gray">{role.label}</p>
                </div>
                <ChevronDown className="hidden md:block w-4 h-4 text-brand-gray" />
              </button>

              {/* Profile Dropdown */}
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-72 bg-white rounded-card border border-brand-border shadow-float overflow-hidden z-50"
                  >
                    {/* User card */}
                    <div className="px-4 py-4 border-b border-brand-border bg-brand-bg">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-brand-blue text-white flex items-center justify-center text-sm font-heading font-semibold">
                          {role.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-heading font-semibold text-brand-ink truncate">{role.name}</p>
                            {isResident && (
                              verified
                                ? <ShieldCheck className="w-4 h-4 text-brand-green shrink-0" strokeWidth={2} />
                                : <ShieldAlert className="w-4 h-4 text-brand-yellow shrink-0" strokeWidth={2} />
                            )}
                          </div>
                          {isResident && (
                            <div className="mt-1">
                              <VerificationBadge status={verified ? "verified" : "pending"} size="sm" />
                            </div>
                          )}
                          <p className="text-xs text-brand-gray mt-1 truncate">{role.name.split(" ")[0].toLowerCase()}@pili.gov.ph</p>
                        </div>
                      </div>
                    </div>
                    {/* Menu items */}
                    <div className="py-1.5">
                      {[
                        { icon: User, label: "Profile", to: profilePath },
                        { icon: Settings, label: "Settings", to: settingsPath },
                        { icon: LifeBuoy, label: "Help Center", to: "#" },
                      ].map((item) => (
                        <Link
                          key={item.label}
                          to={item.to}
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-brand-gray hover:bg-brand-bg hover:text-brand-ink transition-colors"
                        >
                          <item.icon className="w-4 h-4" strokeWidth={1.8} /> {item.label}
                        </Link>
                      ))}
                    </div>
                    <div className="py-1.5 border-t border-brand-border">
                      <button
                        onClick={() => navigate("/login")}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-danger hover:bg-brand-danger/5 transition-colors"
                      >
                        <LogOut className="w-4 h-4" strokeWidth={1.8} /> Logout
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="max-w-content mx-auto px-4 md:px-8 py-8">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}