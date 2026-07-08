import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { LOGO_URL, ROLES } from "@/lib/brand";

export default function Login() {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [role, setRole] = useState("resident-limited");

  const submit = (e) => {
    e.preventDefault();
    navigate(`${ROLES[role].basePath}/dashboard`);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-brand-bg">
      {/* Left brand panel */}
      <div className="hidden lg:flex relative flex-col justify-between p-12 bg-brand-blue overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-blue to-brand-dark" />
        <img src="https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1000&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-15" />
        <div className="relative bg-white rounded-xl p-3 inline-block w-fit"><img src={LOGO_URL} alt="KALUSAGAP" className="h-9 w-auto" /></div>
        <div className="relative">
          <h2 className="text-3xl font-semibold text-white leading-tight">Healthcare for Every Community</h2>
          <p className="mt-4 text-white/80 text-lg max-w-md">Manage records, monitor risks, and improve follow-up care through one connected platform.</p>
        </div>
        <p className="relative text-white/60 text-sm">© 2026 KALUSAGAP — Municipality of Pili</p>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 md:p-12">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-md">
          <div className="lg:hidden mb-8"><img src={LOGO_URL} alt="KALUSAGAP" className="h-9 w-auto" /></div>
          <h1 className="text-2xl md:text-3xl font-semibold text-brand-ink tracking-tight">Welcome back</h1>
          <p className="mt-2 text-brand-gray">Sign in to your KALUSAGAP account.</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div>
              <label className="text-sm font-medium text-brand-ink">Email address</label>
              <div className="mt-1.5 flex items-center gap-2 bg-white border border-brand-border rounded-input px-3.5 py-3 focus-within:border-brand-blue transition-colors">
                <Mail className="w-4 h-4 text-brand-gray" />
                <input type="email" defaultValue="maria.santos@pili.gov.ph" className="bg-transparent outline-none w-full text-sm" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Password</label>
              <div className="mt-1.5 flex items-center gap-2 bg-white border border-brand-border rounded-input px-3.5 py-3 focus-within:border-brand-blue transition-colors">
                <Lock className="w-4 h-4 text-brand-gray" />
                <input type={show ? "text" : "password"} defaultValue="password" className="bg-transparent outline-none w-full text-sm" />
                <button type="button" onClick={() => setShow(!show)} className="text-brand-gray">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Sign in as</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-3 text-sm outline-none focus:border-brand-blue">
                {Object.values(ROLES).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-brand-gray cursor-pointer">
                <input type="checkbox" className="rounded border-brand-border text-brand-blue" defaultChecked /> Remember me
              </label>
              <a href="#" className="text-brand-blue font-medium hover:underline">Forgot password?</a>
            </div>

            <button type="submit" className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white py-3.5 rounded-btn font-medium hover:bg-brand-dark transition-colors shadow-soft">
              Login <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-brand-gray">
            <Link to="/" className="text-brand-blue font-medium hover:underline">← Back to home</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}