import React, { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { usePermissions } from "@/context/PermissionsContext";
import { useAuth } from "@/context/AuthContext";
import PageHeader from "@/components/common/PageHeader";

const PendingVerifications = lazy(() => import("@/features/verification/pages/PendingVerifications"));
const HouseholdVerifications = lazy(() => import("@/features/verification/pages/HouseholdVerifications"));
const StaffAccountApprovals = lazy(() => import("@/features/accounts/pages/StaffAccountApprovals"));

const TABS = [
  { id: "resident", label: "Resident Verification", permission: "residents.registration.approve" },
  { id: "household", label: "Household Verification", permission: "households.verify" },
  {
    id: "bhw",
    label: "BHW Approval",
    permission: "accounts.personnel.approve",
    roles: ["health_supervisor"],
  },
];

export default function VerificationsApprovals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePermissions();
  const { user } = useAuth();
  const requestedTab = searchParams.get("tab");
  const availableTabs = TABS.filter(
    (tab) =>
      (!tab.permission || can(tab.permission)) &&
      (!tab.roles || tab.roles.includes(user?.role)),
  );
  const activeTab = availableTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : availableTabs[0]?.id || null;

  const selectTab = (tab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tab);
    setSearchParams(nextParams);
  };

  useEffect(() => {
    if (activeTab && requestedTab && requestedTab !== activeTab) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", activeTab);
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, requestedTab, searchParams, setSearchParams]);

  return (
    <main className="space-y-4">
      <PageHeader
        eyebrow="Verification"
        title="Verifications & Approvals"
        subtitle="Review resident, household, and BHW requests in one place."
      />

      <section aria-label="Verification and approval workflows">
        {availableTabs.length === 0 ? (
          <p className="rounded-card border border-brand-border bg-white px-4 py-3 text-sm text-brand-gray dark:border-border dark:bg-card">
            No verification or BHW-approval permissions are assigned to this role.
          </p>
        ) : (
        <>
        <div className="tab-scrollbar mb-4 flex w-full gap-2 overflow-x-auto border-b border-brand-border bg-background sm:gap-6 dark:border-border" role="tablist" aria-label="Verification workflows">
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
              className={`-mb-px flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue sm:px-4 ${
                activeTab === tab.id
                  ? "border-brand-blue font-semibold text-brand-ink dark:text-foreground"
                  : "border-transparent font-medium text-brand-gray hover:text-brand-ink dark:hover:text-foreground"
              }`}
            >
              <span>{tab.label}</span>
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
            {activeTab === "resident" && (
              <PendingVerifications
                embedded
              />
            )}
            {activeTab === "household" && (
              <HouseholdVerifications
                embedded
              />
            )}
            {activeTab === "bhw" && (
              <StaffAccountApprovals
                embedded
                bhwOnly
              />
            )}
          </Suspense>
        </div>
        </>
        )}
      </section>
    </main>
  );
}
