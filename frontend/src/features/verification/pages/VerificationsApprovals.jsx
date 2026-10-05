import React, { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { usePermissions } from "@/context/PermissionsContext";

const PendingVerifications = lazy(() => import("@/features/verification/pages/PendingVerifications"));
const HouseholdVerifications = lazy(() => import("@/features/verification/pages/HouseholdVerifications"));
const StaffAccountApprovals = lazy(() => import("@/features/accounts/pages/StaffAccountApprovals"));

const TABS = [
  { id: "resident", label: "Resident Verification" },
  { id: "household", label: "Household Verification" },
  { id: "accounts", label: "Account Approvals" },
];

export default function VerificationsApprovals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePermissions();
  const requestedTab = searchParams.get("tab");
  const availableTabs = TABS.filter((tab) => {
    if (tab.id === "resident") return can("residents.registration.approve");
    if (tab.id === "household") return can("households.verify");
    return true;
  });
  const activeTab = availableTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : availableTabs[0].id;

  const selectTab = (tab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tab);
    setSearchParams(nextParams);
  };

  useEffect(() => {
    if (requestedTab && requestedTab !== activeTab) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", activeTab);
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, requestedTab, searchParams, setSearchParams]);

  return (
    <main className="space-y-4">
      <PageHeader
        crumbs={["Verification & Approvals"]}
        title="Verifications & Approvals"
        subtitle="Review resident, household, and account requests in one place."
      />

      <section aria-label="Verification and approval workflows">
        <div className="mb-4 flex overflow-x-auto border-b border-brand-border" role="tablist" aria-label="Verification workflows">
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              id={`verification-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="verification-tab-panel"
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => {
                const currentIndex = availableTabs.findIndex((item) => item.id === activeTab);
                const nextIndex = event.key === "ArrowRight"
                  ? (currentIndex + 1) % availableTabs.length
                  : event.key === "ArrowLeft"
                    ? (currentIndex - 1 + availableTabs.length) % availableTabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? availableTabs.length - 1
                        : -1;
                if (nextIndex >= 0) {
                  event.preventDefault();
                  const nextTab = availableTabs[nextIndex];
                  selectTab(nextTab.id);
                  document.getElementById(`verification-tab-${nextTab.id}`)?.focus();
                }
              }}
              className={`min-h-11 shrink-0 border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue ${
                activeTab === tab.id
                  ? "border-brand-blue text-brand-blue"
                  : "border-transparent text-brand-gray hover:border-brand-border hover:text-brand-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id="verification-tab-panel"
          role="tabpanel"
          aria-labelledby={`verification-tab-${activeTab}`}
          tabIndex={0}
        >
          <Suspense fallback={<p className="py-6 text-sm text-brand-gray">Loading workflow…</p>}>
            {activeTab === "resident" && <PendingVerifications embedded />}
            {activeTab === "household" && <HouseholdVerifications embedded />}
            {activeTab === "accounts" && <StaffAccountApprovals embedded />}
          </Suspense>
        </div>
      </section>
    </main>
  );
}
