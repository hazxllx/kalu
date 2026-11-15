import React from "react";
import { Activity, Baby, Eye, Heart, Home, Smile, Users } from "lucide-react";
import HealthProgramDirectory from "./HealthProgramDirectory";
import { getAllPrograms } from "@/features/health-records/lib/m1ProgramConfig";

const iconMap = {
  Baby,
  Heart,
  Activity,
  Eye,
  Smile,
  Home,
  Users,
};

const MODULES = getAllPrograms().map((program) => ({
  ...program,
  icon: iconMap[program.icon] || Activity,
}));

function M1ModuleGrid({ countsByModule, loading, countError, query = "", ...directoryProps }) {
  const programs = MODULES.map((module) => {
    const recordCount = countsByModule?.[module.id];
    const waitingForCount = loading || (!countError && recordCount == null);

    return {
      id: module.id,
      name: module.title,
      description: module.description,
      category: module.category,
      icon: module.icon,
      to: query ? `${module.route}?${query}` : module.route,
      recordCount,
      countState: waitingForCount
        ? "loading"
        : Number.isSafeInteger(recordCount) && recordCount >= 0
          ? "ready"
          : "error",
    };
  });

  return <HealthProgramDirectory programs={programs} {...directoryProps} />;
}

export default M1ModuleGrid;
