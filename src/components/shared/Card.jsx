import React from "react";

export function Card({ className = "", children }) {
  return <div className={`bg-white rounded-card border border-brand-border shadow-card ${className}`}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-brand-border">
      <div>
        <h3 className="font-semibold text-brand-ink">{title}</h3>
        {subtitle && <p className="text-sm text-brand-gray mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}