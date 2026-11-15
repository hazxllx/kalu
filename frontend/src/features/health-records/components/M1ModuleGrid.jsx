import React from "react";
import { ArrowRight, Activity, Heart, Eye, Smile, Home, Users, Baby } from "lucide-react";
import { Link } from "react-router-dom";
import { getAllPrograms, getCategories } from "@/features/health-records/lib/m1ProgramConfig";

/**
 * M1ModuleGrid — Compact on-screen interface for 7 KALUSAGAP health modules
 * 
 * Displays:
 * - Prenatal and Postpartum (Maternal & Family Health)
 * - NCD Risk Assessment (Screening & Preventive Care)
 * - Cervical Cancer and Breast Mass Examination
 * - Visual Acuity and PPV
 * - Oral Health
 * - Household Environmental Masterlist (Environmental Health)
 * - Program Enrollment Register (Community Health Programs)
 * 
 * Each module shows dynamic record count and opens to its dedicated program detail page.
 */

const iconMap = {
  Baby,
  Heart,
  Activity,
  Eye,
  Smile,
  Home,
  Users,
};

const MODULES = getAllPrograms().map(program => ({
  ...program,
  icon: iconMap[program.icon] || Activity,
}));

function ModuleCard({ module, count, loading, query }) {
  const IconComponent = module.icon;
  const destination = query ? `${module.route}?${query}` : module.route;

  return (
    <Link
      to={destination}
      className="group flex min-w-0 items-start gap-3 rounded-btn border border-brand-border bg-brand-paper px-3.5 py-3 text-left transition-all hover:border-brand-rule hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
      aria-label={`Open ${module.title}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-brand-light text-brand-blue" aria-hidden="true"><IconComponent className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold leading-tight text-brand-ink">{module.title}</span><span className="mt-0.5 block text-xs leading-tight text-brand-gray">{module.description}</span></span>
      <span className="flex shrink-0 items-center gap-2">
        {(loading || count != null) && <span className="inline-flex items-center rounded-btn border border-brand-border bg-brand-paper px-1.5 py-0.5 text-[10px] font-medium font-stat text-brand-gray">{loading ? "—" : count}</span>}
        <ArrowRight className="h-3.5 w-3.5 text-brand-blue transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

function M1ModuleGrid({ countsByModule, loading, query = "" }) {
  // Group modules by category using the config
  const grouped = MODULES.reduce((acc, module) => {
    if (!acc[module.category]) {
      acc[module.category] = [];
    }
    acc[module.category].push(module);
    return acc;
  }, {});

  const categories = getCategories();

  return (
    <div className="space-y-6">
      {categories.map((category) => (
        <section key={category}>
          <div className="mb-3 flex items-center gap-3"><h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-ink">{category}</h2><span className="h-px flex-1 bg-brand-border" aria-hidden="true" /></div>
          <div className="grid gap-3 lg:grid-cols-2">
            {grouped[category]?.map((module) => (
              <ModuleCard
                key={module.id}
                module={module}
                count={countsByModule?.[module.id]}
                loading={loading}
                query={query}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default M1ModuleGrid;
