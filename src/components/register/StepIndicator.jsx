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
  const total = STEPS.length;
  const done = completed.length;

  return (
    <div>
      {/* Progress ledger line */}
      <div className="flex items-baseline justify-between border-b border-brand-border pb-2.5">
        <p className="gov-kicker text-brand-blue">
          Step {String(current).padStart(2, "0")} of {String(total).padStart(2, "0")}
        </p>
        <p className="font-stat text-[11px] font-bold tracking-[0.1em] text-brand-gray">
          {Math.round((done / total) * 100)}% Complete
        </p>
      </div>

      <div className="mt-5 flex items-start justify-between">
        {STEPS.map((step, i) => {
          const isComplete = completed.includes(step.num);
          const isActive = current === step.num;
          const isLast = i === STEPS.length - 1;
          const state = isComplete ? "complete" : isActive ? "active" : "pending";

          return (
            <div key={step.num} className="flex flex-1 items-start last:flex-none">
              <div className="flex w-[52px] flex-col items-center gap-2">
                <motion.div
                  initial={false}
                  animate={{
                    backgroundColor:
                      state === "pending" ? "#FFFFFF" : "#12518F",
                    borderColor:
                      state === "pending" ? "#DCE4EE" : "#12518F",
                  }}
                  transition={{ duration: 0.3 }}
                  className="flex h-8 w-8 items-center justify-center border-2"
                >
                  {isComplete ? (
                    <Check className="h-4 w-4 text-white" strokeWidth={3} />
                  ) : (
                    <span
                      className={`font-stat text-[12px] font-bold ${
                        isActive ? "text-white" : "text-brand-gray"
                      }`}
                    >
                      {String(step.num).padStart(2, "0")}
                    </span>
                  )}
                </motion.div>
                <span
                  className={`whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.1em] ${
                    isActive
                      ? "text-brand-blue"
                      : isComplete
                      ? "text-brand-ink"
                      : "text-brand-gray/70"
                  }`}
                >
                  {step.label}
                </span>
                {isActive && (
                  <motion.span
                    layoutId="step-marker"
                    className="h-[2px] w-6 bg-brand-gold"
                    aria-hidden="true"
                  />
                )}
              </div>

              {!isLast && (
                <div className="mt-[15px] h-px flex-1 bg-brand-border">
                  <motion.div
                    initial={false}
                    animate={{ width: isComplete ? "100%" : "0%" }}
                    transition={{ duration: 0.4 }}
                    className="h-full bg-brand-blue"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
