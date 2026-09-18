import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import {
  coverageOptions,
  coverageSubtitle,
  coverageTitleLabel,
  defaultCoverage,
  isPHN,
  resolveCoverage,
} from "@/lib/phnScope";

/**
 * Active "coverage" for the signed-in Public Health Nurse.
 *
 * A barangay-assigned PHN can switch their working coverage between their
 * assigned barangay (e.g. "San Isidro") and the RHU. The selection is shared
 * by every PHN page (dashboard, check-ups, referrals, follow-ups, health
 * services, records, reports, notifications) so the data shown stays
 * consistent, and it is remembered per account in localStorage.
 *
 * Defaults to the assigned barangay (San Isidro for the barangay PHN) while an
 * RHU-only PHN only ever gets the "RHU" coverage. The value is one of the
 * `RHU_OPTION` sentinel ("RHU") or the assigned barangay name.
 */

const PhnCoverageContext = createContext(null);

const coverageStorageKey = (email) => `kalusagap.phn.coverage.${email || "anonymous"}`;

const readStoredCoverage = (user) => {
  if (!user || !isPHN(user)) return null;
  try {
    const raw = window.localStorage.getItem(coverageStorageKey(user.email));
    if (raw) return resolveCoverage(user, raw);
  } catch {
    /* storage may be unavailable */
  }
  return defaultCoverage(user);
};

export const PhnCoverageProvider = ({ children }) => {
  const { user } = useAuth();
  const email = user?.email || "";

  const [state, setState] = useState(() => ({
    email,
    coverage: readStoredCoverage(user),
  }));

  // Reset the coverage whenever the signed-in account changes (login or
  // logout) so one account's selection never leaks into another account's
  // session.
  if (state.email !== email) {
    setState({ email, coverage: readStoredCoverage(user) });
  }

  const options = useMemo(() => coverageOptions(user), [user]);

  const setCoverage = useCallback(
    (value) => {
      setState((prev) => {
        const coverage = resolveCoverage(user, value);
        if (!coverage) return prev;
        try {
          window.localStorage.setItem(coverageStorageKey(user.email), coverage);
        } catch {
          /* storage may be unavailable */
        }
        return { email: prev.email, coverage };
      });
    },
    [user]
  );

  const value = useMemo(
    () => ({
      coverage: state.coverage,
      setCoverage,
      options,
      canSwitch: options.length > 1,
      coverageLabel: coverageTitleLabel(state.coverage),
      coverageSubtitle: coverageSubtitle(state.coverage),
    }),
    [state.coverage, setCoverage, options]
  );

  return <PhnCoverageContext.Provider value={value}>{children}</PhnCoverageContext.Provider>;
};

export const usePhnCoverage = () => {
  const context = useContext(PhnCoverageContext);
  if (!context) {
    throw new Error("usePhnCoverage must be used within a PhnCoverageProvider");
  }
  return context;
};

export default PhnCoverageContext;
