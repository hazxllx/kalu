import React from "react";

export function Card({ className = "", children, ...props }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-6 pt-5 pb-4">
      <div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}