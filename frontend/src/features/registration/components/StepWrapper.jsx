// frontend/src/features/registration/components/StepWrapper.jsx
import React from "react";
import { motion, AnimatePresence } from "framer-motion";

// Renders or manages StepWrapper logic.
export default function StepWrapper({ step, children }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}