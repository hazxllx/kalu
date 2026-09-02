import React, { useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Users, Droplet, Home, Wallet, Plus, RefreshCw, Cloud, CloudOff } from "lucide-react";
import { households } from "@/services/mock/mockData";
import StatusBadge from "@/components/common/StatusBadge";

function riskBadge(score) {
  if (score >= 60) return { label: "High Risk", classes: "text-brand-danger bg-brand-danger/10" };
  if (score >= 40) return { label: "Medium Risk", classes: "text-[#B07E00] bg-brand-yellow/15" };
  return { label: "Low Risk", classes: "text-brand-green bg-brand-green/10" };
}

export default function Households() {
  const [syncStatus, setSyncStatus] = useState("offline");
  const [householdList, setHouseholdList] = useState(households);
  const [toast, setToast] = useState(null);

  const handleSync = () => {
    setSyncStatus("syncing");
    setTimeout(() => {
      setSyncStatus("connected");
      setHouseholdList((prev) =>
        prev.map((h) => ({ ...h, syncStatus: null }))
      );
      setToast("Synchronization Complete - All pending records have been uploaded successfully.");
      setTimeout(() => setToast(null), 3000);
    }, 2000);
  };

  const handleAddHousehold = () => {
    const newHousehold = {
      id: `HH-${String(householdList.length + 1).padStart(3, '0')}`,
      address: "New Household Address",
      members: 4,
      riskScore: 35,
      income: "₱10,000/mo",
      water: "Level II - Communal",
      toilet: "Water-sealed",
      concerns: [],
      syncStatus: "Pending Sync",
    };
    setHouseholdList([newHousehold, ...householdList]);
    setToast("Saved Offline - This record will automatically synchronize once an internet connection becomes available.");
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <>
      <PageHeader crumbs={["Home", "Household Profiling"]} title="Household Profiling" subtitle="Household conditions and risk classification across the barangay."
        action={<button onClick={handleAddHousehold} className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"><Plus className="w-4 h-4" /> Add Household</button>} />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <RefreshCw className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Synchronization Status */}
      <Card className="p-4 mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {syncStatus === "offline" && (
              <>
                <CloudOff className="w-5 h-5 text-amber-600" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Offline Mode</p>
                  <p className="text-xs text-brand-gray">{householdList.filter(h => h.syncStatus === "Pending Sync").length} households waiting to sync</p>
                </div>
              </>
            )}
            {syncStatus === "syncing" && (
              <>
                <RefreshCw className="w-5 h-5 text-brand-blue animate-spin" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Syncing...</p>
                  <p className="text-xs text-brand-gray">Uploading household profiles...</p>
                </div>
              </>
            )}
            {syncStatus === "connected" && (
              <>
                <Cloud className="w-5 h-5 text-brand-green" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Connected</p>
                  <p className="text-xs text-brand-gray">All households synchronized</p>
                </div>
              </>
            )}
          </div>
          {syncStatus === "offline" && householdList.filter(h => h.syncStatus === "Pending Sync").length > 0 && (
            <button
              onClick={handleSync}
              className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Sync Now
            </button>
          )}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        {householdList.map((h, i) => {
          const badge = riskBadge(h.riskScore);
          return (
            <motion.div key={h.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-brand-gray">{h.id}</p>
                    <h3 className="font-semibold text-brand-ink mt-0.5">{h.address}</h3>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className={`rounded-xl px-3 py-2 text-sm font-semibold ${badge.classes}`}>
                      {badge.label}
                    </div>
                    {h.syncStatus && (
                      <StatusBadge value={h.syncStatus} />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
                  <p className="flex items-center gap-2 text-brand-gray"><Users className="w-4 h-4 text-brand-blue" /> {h.members} members</p>
                  <p className="flex items-center gap-2 text-brand-gray"><Wallet className="w-4 h-4 text-brand-blue" /> {h.income}</p>
                  <p className="flex items-center gap-2 text-brand-gray"><Droplet className="w-4 h-4 text-brand-blue" /> {h.water}</p>
                  <p className="flex items-center gap-2 text-brand-gray"><Home className="w-4 h-4 text-brand-blue" /> {h.toilet}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {h.concerns.map((c) => <span key={c} className="text-xs bg-brand-light text-brand-blue px-2.5 py-1 rounded-full">{c}</span>)}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}