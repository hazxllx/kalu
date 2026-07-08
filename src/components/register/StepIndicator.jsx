import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

const STEPS = [
  { num: 1, label: "Personal" },
  { num: 2, label: "Contact" },
  { num: 3, label: "Account" },
  { num: 4, label: "Face" },
  { num: 5, label: "Review" },
  { num: 6, label: "Submit" },
];

export default function StepIndicator({ current, completed = [] }) {
  return (
    <div className="flex items-center justify-between max-w-2xl mx-auto">
      {STEPS.map((step, i) => {
        const isComplete = completed.includes(step.num);
        const isActive = current === step.num;
        const isLast = i === STEPS.length - 1;
        return (
          <div key={step.num} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <motion.div
                initial={false}
                animate={{
                  scale: isActive ? 1.1 : 1,
                  backgroundColor: isComplete ? "#0B5CAD" : isActive ? "#0B5CAD" : "#FFFFFF",
                  borderColor: isComplete || isActive ? "#0B5CAD" : "#E5EAF1",
                }}
                className="w-9 h-9 rounded-full border-2 flex items-center justify-center"
              >
                {isComplete ? (
                  <Check className="w-4 h-4 text-white" strokeWidth={2.5} />
                ) : (
                  <span className={`text-sm font-stat font-bold ${isActive || isComplete ? "text-white" : "text-brand-gray"}`}>
                    {step.num}
                  </span>
                )}
              </motion.div>
              <span className={`text-[11px] font-body font-medium whitespace-nowrap ${isActive ? "text-brand-blue" : isComplete ? "text-brand-ink" : "text-brand-gray"}`}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className="flex-1 h-0.5 mx-2 -mt-5 rounded-full overflow-hidden bg-brand-border">
                <motion.div
                  initial={false}
                  animate={{ width: completed.includes(step.num) ? "100%" : "0%" }}
                  transition={{ duration: 0.4 }}
                  className="h-full bg-brand-blue"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}