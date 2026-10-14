import React, { useEffect, useMemo, useState } from "react";
import {
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import Icon from "@/components/common/Icon";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { ROLE } from "@/lib/roles";
import {
  ACTION_LABEL,
  ALL_PERMISSION_IDS,
  MANAGED_ROLES,
  PERMISSION_MODULES,
  ROLE_POLICY,
  countGranted,
  countGrantedInModule,
  defaultPermissionsForRole,
  diffPermissionMaps,
  getManagedRole,
  getModule,
  getPermission,
  isPermissionLocked,
  normalizePermissionValue,
} from "@/lib/permissions";

import ConfirmPermissionDialog from "@/features/access-control/components/ConfirmPermissionDialog";
import PermissionAuditFeed from "@/features/access-control/components/PermissionAuditFeed";
import PermissionMatrixTable from "@/features/access-control/components/PermissionMatrixTable";

const plural = (count, singular, suffix = "s") => `${count} ${singular}${count === 1 ? "" : suffix}`;
const summarise = (labels, max = 3) => {
  if (labels.length <= max) return labels.join(", ");
  return `${labels.slice(0, max).join(", ")} and ${labels.length - max} more`;
};

// ----- Roles overview section -----
const RolesOverviewSection = ({ permissionsForRole, selectedRoleId, onSelectRole }) => {
  const total = ALL_PERMISSION_IDS.length;
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-brand-ink">Roles Overview</h3>
          <p className="mt-0.5 text-xs text-brand-gray">
            What each role is responsible for and how many permissions it currently holds. Select a role below to edit its permissions.
          </p>
        </div>
      </div>
      <div className="space-y-3">
        {MANAGED_ROLES.map((role) => {
          const permissions = permissionsForRole(role.id);
          const granted = countGranted(permissions);
          const activeModules = PERMISSION_MODULES.filter(
            (mod) => countGrantedInModule(mod.id, permissions).on > 0,
          );
          const isSelected = role.id === selectedRoleId;

          return (
            <button
              type="button"
              key={role.id}
              onClick={() => onSelectRole(role.id)}
              aria-pressed={isSelected}
              className={`block w-full rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 ${isSelected ? "border-brand-blue bg-brand-blue/5" : "border-brand-border bg-white hover:border-brand-blue/50"}`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand-blue">
                    <Icon name={role.icon} className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-brand-ink">{role.label}</p>
                      {ROLE_POLICY[role.id] && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-goldpale px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-amber">
                          <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
                          Guard-railed
                        </span>
                      )}
                      {isSelected && (
                        <span className="rounded-full bg-brand-blue px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-brand-gray">{role.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {activeModules.length === 0 ? (
                        <span className="text-xs text-slate-400">No modules enabled</span>
                      ) : (
                        activeModules.map((mod) => {
                          const { on, total: modTotal } = countGrantedInModule(mod.id, permissions);
                          return (
                            <span
                              key={mod.id}
                              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600"
                            >
                              {mod.short} <span className="num text-slate-400">{on}/{modTotal}</span>
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 md:flex-col md:items-end md:gap-1">
                  <span className="num text-sm text-brand-gray">
                    <span className="font-semibold text-brand-ink">{granted}</span>/{total} permissions
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
};

/**
 * Role & Access Management — unified admin access-control page.
 *
 * Merges the former separate "Roles" overview and "Role & Permissions" editor
 * into one coherent interface with a single sidebar entry.
 */
export default function RoleAccessManagementPage() {
  const { role: actorRole, user } = useAuth();
  const {
    permissionsForRole,
    matrixLoadState,
    saveRolePermissions,
    auditEntries,
    can,
  } = usePermissions();
  const { toast } = useToast();

  const [selectedRoleId, setSelectedRoleId] = useState(MANAGED_ROLES[0].id);
  const [draft, setDraft] = useState(() => permissionsForRole(MANAGED_ROLES[0].id));
  const [confirmRequest, setConfirmRequest] = useState(null);
  const [expandedModuleId, setExpandedModuleId] = useState(null);
  const [query, setQuery] = useState("");
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("permissions");

  const selectedRole = getManagedRole(selectedRoleId) || MANAGED_ROLES[0];
  const saved = useMemo(() => permissionsForRole(selectedRoleId), [permissionsForRole, selectedRoleId]);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const changedIds = useMemo(() => diffPermissionMaps(saved, draft), [saved, draft]);
  const isDirty = changedIds.length > 0;
  const roleAuditEntries = useMemo(
    () => auditEntries.filter((entry) => entry.roleId === selectedRoleId),
    [auditEntries, selectedRoleId],
  );

  const visibleModules = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle && !sensitiveOnly) return PERMISSION_MODULES;
    return PERMISSION_MODULES.map((mod) => {
      const permissions = mod.permissions.filter((perm) => {
        if (sensitiveOnly && !perm.sensitive) return false;
        if (!needle) return true;
        return (
          perm.label.toLowerCase().includes(needle) ||
          perm.description.toLowerCase().includes(needle) ||
          mod.label.toLowerCase().includes(needle)
        );
      });
      return permissions.length === mod.permissions.length ? mod : { ...mod, permissions };
    }).filter((mod) => mod.permissions.length > 0);
  }, [query, sensitiveOnly]);

  // ---- Draft mutation ----
  const applyValues = (permissionIds, value) => {
    setDraft((current) => {
      const next = { ...current };
      permissionIds.forEach((id) => {
        next[id] = normalizePermissionValue(selectedRoleId, id, value);
      });
      return next;
    });
  };

  const handleToggle = (permission, nextValue) => {
    if (isPermissionLocked(selectedRoleId, permission.id)) return;
    if (!permission.sensitive) {
      applyValues([permission.id], nextValue);
      return;
    }
    const enriched = getPermission(permission.id) || permission;
    const phrase = enriched.impact || enriched.label.toLowerCase();
    setConfirmRequest({
      tone: nextValue ? "grant" : "revoke",
      title: `${nextValue ? "Enable" : "Disable"} ${enriched.label} for ${selectedRole.label}?`,
      description: nextValue
        ? `This will allow ${selectedRole.plural} to ${phrase}.`
        : `${selectedRole.plural} will no longer be able to ${phrase}.`,
      meta: [
        { label: "Module", value: enriched.moduleLabel },
        { label: "Role", value: selectedRole.label },
        { label: "Change", value: nextValue ? "Denied \u2192 Allowed" : "Allowed \u2192 Denied" },
      ],
      confirmLabel: "Confirm",
      onConfirm: () => applyValues([enriched.id], nextValue),
    });
  };

  const handleActionToggle = (module, action, actionPermissions, nextValue) => {
    const targets = actionPermissions.filter(
      (permission) =>
        !isPermissionLocked(selectedRoleId, permission.id) && Boolean(draft[permission.id]) !== nextValue,
    );
    if (targets.length === 0) return;
    const lockedCount = actionPermissions.length - actionPermissions.filter(
      (permission) => !isPermissionLocked(selectedRoleId, permission.id),
    ).length;
    const sensitive = targets.filter((permission) => permission.sensitive);
    const ids = targets.map((permission) => permission.id);
    if (sensitive.length === 0 && lockedCount === 0) {
      applyValues(ids, nextValue);
      return;
    }
    setConfirmRequest({
      tone: nextValue ? "grant" : "revoke",
      title: `${nextValue ? "Enable" : "Disable"} ${ACTION_LABEL[action]} permissions in ${module.label}?`,
      description: nextValue
        ? `This will grant ${plural(targets.length, "permission")} for ${ACTION_LABEL[action].toLowerCase()} actions in ${module.label} to ${selectedRole.plural}.`
        : `This will remove ${plural(targets.length, "permission")} for ${ACTION_LABEL[action].toLowerCase()} actions in ${module.label} from ${selectedRole.plural}.`,
      meta:
        sensitive.length > 0
          ? [
              { label: "Sensitive actions", value: summarise(sensitive.map((permission) => permission.label)) },
              { label: "Total affected", value: plural(targets.length, "permission") },
            ]
          : [{ label: "Total affected", value: plural(targets.length, "permission") }],
      note:
        lockedCount > 0
          ? `${plural(lockedCount, "permission")} in this action group ${lockedCount === 1 ? "is" : "are"} fixed by policy and will not change.`
          : undefined,
      confirmLabel: "Confirm",
      onConfirm: () => applyValues(ids, nextValue),
    });
  };

  const handleBulk = (module, nextValue) => {
    const fullModule = getModule(module.id) || module;
    const targets = fullModule.permissions.filter(
      (perm) => !isPermissionLocked(selectedRoleId, perm.id) && Boolean(draft[perm.id]) !== nextValue,
    );
    if (targets.length === 0) return;
    const ids = targets.map((perm) => perm.id);
    const sensitive = targets.filter((perm) => perm.sensitive);
    const lockedCount = fullModule.permissions.filter((perm) =>
      isPermissionLocked(selectedRoleId, perm.id),
    ).length;
    if (sensitive.length === 0 && lockedCount === 0) {
      applyValues(ids, nextValue);
      return;
    }
    setConfirmRequest({
      tone: nextValue ? "grant" : "revoke",
      title: `${nextValue ? "Enable" : "Disable"} all ${fullModule.label} permissions for ${selectedRole.label}?`,
      description: nextValue
        ? `This will grant ${plural(targets.length, "permission")} in ${fullModule.label} to ${selectedRole.plural}.`
        : `This will remove ${plural(targets.length, "permission")} in ${fullModule.label} from ${selectedRole.plural}.`,
      meta:
        sensitive.length > 0
          ? [
              { label: "Sensitive actions", value: summarise(sensitive.map((perm) => perm.label)) },
              { label: "Total affected", value: plural(targets.length, "permission") },
            ]
          : [{ label: "Total affected", value: plural(targets.length, "permission") }],
      note:
        lockedCount > 0
          ? `${plural(lockedCount, "permission")} in this module ${lockedCount === 1 ? "is" : "are"} fixed by policy and will not change.`
          : undefined,
      confirmLabel: nextValue ? "Enable all" : "Disable all",
      onConfirm: () => applyValues(ids, nextValue),
    });
  };

  // ---- Commit / discard / reset ----
  const handleSave = async () => {
    if (saving || !isDirty) return;
    setSaving(true);
    try {
      const { changedIds: applied } = await saveRolePermissions(selectedRoleId, draft);
      toast({
        title: "Permissions updated successfully.",
        description: `${plural(applied.length, "change")} saved for ${selectedRole.label}.`,
      });
    } catch (err) {
      toast({
        tone: "danger",
        title: "Could not save permissions.",
        description: err?.message || "The server rejected the change. Only administrators can edit permissions.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!isDirty) return;
    setConfirmRequest({
      tone: "revoke",
      title: `Discard unsaved changes for ${selectedRole.label}?`,
      description: `${plural(changedIds.length, "permission change")} on ${selectedRole.label} ${changedIds.length === 1 ? "has" : "have"} not been saved yet.`,
      confirmLabel: "Discard changes",
      onConfirm: () => setDraft({ ...saved }),
    });
  };

  const handleReset = () => {
    const defaults = defaultPermissionsForRole(selectedRoleId);
    const resetDiff = diffPermissionMaps(draft, defaults);
    if (resetDiff.length === 0) {
      toast({
        title: `${selectedRole.label} already matches its default permissions.`,
        description: isDirty ? "Save Changes to apply the staged permissions." : undefined,
      });
      return;
    }
    setConfirmRequest({
      tone: "reset",
      title: `Reset ${selectedRole.label} to default permissions?`,
      description: `${plural(resetDiff.length, "permission")} will be staged to match the KALUSAGAP default. Save Changes to apply them.`,
      meta: [
        { label: "Role", value: selectedRole.label },
        { label: "Permissions to reset", value: String(resetDiff.length) },
      ],
      note: isDirty
        ? `${plural(changedIds.length, "unsaved change")} on this role will be discarded.`
        : undefined,
      confirmLabel: "Reset to defaults",
      onConfirm: () => {
        setDraft(defaults);
        toast({
          title: `${selectedRole.label} defaults restored in the editor.`,
          description: "Save Changes to apply them.",
        });
      },
    });
  };

  const handleSelectRole = (roleId) => {
    if (roleId === selectedRoleId) {
      setActiveTab("permissions");
      return;
    }
    if (!isDirty) {
      setDraft(permissionsForRole(roleId));
      setSelectedRoleId(roleId);
      setActiveTab("permissions");
      return;
    }
    setConfirmRequest({
      tone: "revoke",
      title: `Discard unsaved changes for ${selectedRole.label}?`,
      description: `${plural(changedIds.length, "permission change")} on ${selectedRole.label} ${changedIds.length === 1 ? "has" : "have"} not been saved yet.`,
      confirmLabel: "Discard and switch",
      onConfirm: () => {
        setDraft(permissionsForRole(roleId));
        setSelectedRoleId(roleId);
        setActiveTab("permissions");
      },
    });
  };

  const handleOpenModule = (moduleId) => {
    const closing = expandedModuleId === moduleId;
    setExpandedModuleId(closing ? null : moduleId);
    if (!closing) {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`permission-module-${moduleId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  };

  // ---- Guards ----
  if (actorRole !== ROLE.ADMIN || !can("accounts.roles.manage")) {
    return (
      <>
        <PageHeader
          crumbs={["Access Control", "Role & Access Management"]}
          title="Role & Access Management"
          subtitle="Administrator-only area."
        />
        <Card className="p-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-danger/10 text-brand-danger">
            <ShieldAlert className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <h2 className="mt-4 font-heading text-lg font-semibold text-slate-900">Access restricted</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-slate-600">
            Only an administrator holding "Manage roles and permissions" may view or change role
            privileges. Ask a system administrator if you need this access.
          </p>
        </Card>
      </>
    );
  }

  const permissionsLoading =
    matrixLoadState.userId !== user?.id || matrixLoadState.status === "loading";
  if (permissionsLoading || matrixLoadState.status === "error") {
    return (
      <>
        <PageHeader
          crumbs={["Access Control", "Role & Access Management"]}
          title="Role & Access Management"
          subtitle="Manage roles and permissions for every system role."
        />
        <Card className="p-6">
          <p className={`text-sm ${matrixLoadState.status === "error" ? "text-brand-danger" : "text-slate-600"}`}>
            {!permissionsLoading && matrixLoadState.status === "error"
              ? `Unable to load role permissions. ${matrixLoadState.error}`
              : "Loading role permissions..."}
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={["Access Control", "Role & Access Management"]}
        title="Role & Access Management"
        subtitle="Configure roles and manage access privileges for each system role."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit gap-1 rounded-lg border border-brand-border bg-white p-1">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === "overview" ? "bg-brand-blue text-white" : "text-brand-gray hover:bg-slate-50 hover:text-brand-ink"}`}
          >
            Roles Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("permissions")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === "permissions" ? "bg-brand-blue text-white" : "text-brand-gray hover:bg-slate-50 hover:text-brand-ink"}`}
          >
            Permission Matrix
          </button>
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {isDirty && (
            <span className="mr-1 text-xs font-medium text-brand-amber" role="status">
              {changedIds.length} unsaved change{changedIds.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            onClick={handleDiscard}
            disabled={!isDirty || saving}
            className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
            Discard Changes
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={1.9} />
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save className="h-4 w-4" strokeWidth={1.9} />
            {saving ? "Saving..." : "Save Changes"}
            {isDirty && (
              <span className="num rounded-full bg-white/20 px-1.5 text-xs font-bold">{changedIds.length}</span>
            )}
          </button>
        </div>
      </div>

      {activeTab === "overview" ? (
        <RolesOverviewSection
          permissionsForRole={permissionsForRole}
          selectedRoleId={selectedRoleId}
          onSelectRole={handleSelectRole}
        />
      ) : (
        <div className="min-w-0 space-y-4">
            {/* Search + filter */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/15">
                <Search className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search permissions or modules..."
                  aria-label="Filter permissions"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear filter">
                    <X className="h-4 w-4 text-slate-500 hover:text-slate-700" />
                  </button>
                )}
              </div>
              <label className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={sensitiveOnly}
                  onChange={(event) => setSensitiveOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-brand-border text-brand-blue focus:ring-brand-blue"
                />
                Sensitive actions only
              </label>
            </div>

            {visibleModules.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-sm text-slate-600">No permissions match the current search or filter.</p>
              </Card>
            ) : (
              <PermissionMatrixTable
                role={selectedRole}
                permissions={draft}
                modules={visibleModules}
                expandedModuleId={expandedModuleId}
                onOpenModule={handleOpenModule}
                onActionToggle={handleActionToggle}
                onToggle={handleToggle}
                onBulk={handleBulk}
              />
            )}

            <PermissionAuditFeed
              entries={roleAuditEntries.length > 0 ? roleAuditEntries : auditEntries}
              viewAllTo="/app/admin/audit"
            />
        </div>
      )}

      <ConfirmPermissionDialog
        request={confirmRequest}
        onCancel={() => setConfirmRequest(null)}
        onConfirm={() => {
          confirmRequest?.onConfirm?.();
          setConfirmRequest(null);
        }}
      />
    </>
  );
}
