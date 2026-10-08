import React, { useEffect, useMemo, useState } from "react";
import {
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { ROLE } from "@/lib/roles";
import {
  ACTION_LABEL,
  ALL_PERMISSION_IDS,
  MANAGED_ROLES,
  PERMISSION_MODULES,
  countGranted,
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
import RoleSelectorRail from "@/features/access-control/components/RoleSelectorRail";

const plural = (count, singular, suffix = "s") => `${count} ${singular}${count === 1 ? "" : suffix}`;

const summarise = (labels, max = 3) => {
  if (labels.length <= max) return labels.join(", ");
  return `${labels.slice(0, max).join(", ")} and ${labels.length - max} more`;
};

/**
 * Role & Permissions — the administrator's access-control centre.
 *
 * Renders itself from the registry in `@/lib/permissions`: roles come from
 * `MANAGED_ROLES`, columns from `ACTION_ORDER`, rows from `PERMISSION_MODULES`.
 * Adding a permission to the registry surfaces it here automatically, so
 * "can this role approve referrals?" is a data question, never a code change.
 *
 * Edits are staged in a draft and only committed on Save, which is also when
 * the audit trail is written (previous value -> new value, with the account and
 * timestamp). Sensitive actions ask for confirmation first, and the guard-rails
 * in the registry stop an administrator from removing their own essential
 * access or granting administrative powers to a Resident.
 */
export default function RolePermissionsPage() {
  const { role: actorRole, user } = useAuth();
  const {
    permissionsForRole,
    matrixLoadState,
    saveRolePermissions,
    resetRoleToDefaults,
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

  const selectedRole = getManagedRole(selectedRoleId) || MANAGED_ROLES[0];
  const saved = useMemo(() => permissionsForRole(selectedRoleId), [permissionsForRole, selectedRoleId]);

  // Re-base the draft whenever the role changes or the stored matrix moves on.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const changedIds = useMemo(() => diffPermissionMaps(saved, draft), [saved, draft]);
  const isDirty = changedIds.length > 0;

  const grantedCount = countGranted(draft);
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

  /* --------------------------------------------------------------------- */
  /* Draft mutation                                                        */
  /* --------------------------------------------------------------------- */

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
        { label: "Change", value: nextValue ? "Denied → Allowed" : "Allowed → Denied" },
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

  /* --------------------------------------------------------------------- */
  /* Commit / discard / reset                                              */
  /* --------------------------------------------------------------------- */

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

  const handleReset = () => {
    const defaults = defaultPermissionsForRole(selectedRoleId);
    const savedDiff = diffPermissionMaps(saved, defaults);

    if (savedDiff.length === 0 && !isDirty) {
      toast({ title: `${selectedRole.label} already matches its default permissions.` });
      return;
    }

    setConfirmRequest({
      tone: "reset",
      title: `Reset ${selectedRole.label} to default permissions?`,
      description:
        savedDiff.length > 0
          ? `${plural(savedDiff.length, "saved permission")} will return to the KALUSAGAP default for this role.`
          : `${selectedRole.label} will be restored to the KALUSAGAP default for this role.`,
      meta: [
        { label: "Role", value: selectedRole.label },
        { label: "Saved changes reverted", value: String(savedDiff.length) },
      ],
      note: isDirty
        ? `${plural(changedIds.length, "unsaved change")} on this role will be discarded.`
        : undefined,
      confirmLabel: "Reset to defaults",
      onConfirm: async () => {
        try {
          const { changedIds: applied } = await resetRoleToDefaults(selectedRoleId);
          setDraft(defaultPermissionsForRole(selectedRoleId));
          toast({
            title: "Permissions updated successfully.",
            description: `${selectedRole.label} restored to defaults — ${plural(applied.length, "change")} recorded.`,
          });
        } catch (err) {
          toast({
            tone: "danger",
            title: "Could not reset permissions.",
            description: err?.message || "The server rejected the change.",
          });
        }
      },
    });
  };

  const handleSelectRole = (roleId) => {
    if (roleId === selectedRoleId) return;
    if (!isDirty) {
      setDraft(permissionsForRole(roleId));
      setSelectedRoleId(roleId);
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

  /* --------------------------------------------------------------------- */
  /* Render                                                               */
  /* --------------------------------------------------------------------- */

  // Administrator-only area. Route-level RBAC already blocks other roles; this
  // is the defence-in-depth check for the page itself.
  if (actorRole !== ROLE.ADMIN || !can("accounts.roles.manage")) {
    return (
      <>
        <PageHeader
          crumbs={["Access Control", "Role & Permissions"]}
          title="Role & Permissions"
          subtitle="Administrator-only area."
        />
        <Card className="p-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-danger/10 text-brand-danger">
            <ShieldAlert className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <h2 className="mt-4 font-heading text-lg font-semibold text-slate-900">Access restricted</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-slate-600">
            Only an administrator holding “Manage roles and permissions” may view or change role
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
          crumbs={["Access Control", "Role & Permissions"]}
          title="Role & Permissions"
          subtitle="Manage access privileges for each system role."
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
        crumbs={["Access Control", "Role & Permissions"]}
        title="Role & Permissions"
        subtitle="Manage access privileges for each system role."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {isDirty && (
              <span className="mr-1 text-xs font-medium text-brand-amber" role="status">
                Unsaved changes
              </span>
            )}
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
              {saving ? "Saving..." : "Save changes"}
              {isDirty && (
                <span className="num rounded-full bg-white/20 px-1.5 text-xs font-bold">{changedIds.length}</span>
              )}
            </button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)]">
        <aside>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Roles</h2>
            <span className="num text-[11px] font-medium text-slate-500">
              {grantedCount}/{ALL_PERMISSION_IDS.length}
            </span>
          </div>
          <div className="lg:sticky lg:top-24">
            <RoleSelectorRail
              roles={MANAGED_ROLES}
              selectedRoleId={selectedRoleId}
              dirtyRoleId={isDirty ? selectedRoleId : null}
              permissionsForRole={(roleId) => (roleId === selectedRoleId ? draft : permissionsForRole(roleId))}
              onSelect={handleSelectRole}
            />
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
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
      </div>

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
