import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (path) => fs.readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
const routes = source("routes/AppRoutes.jsx");
const chooser = source("features/registration/pages/RegistrationTypeSelection.jsx");
const management = source("features/users/pages/UserManagement.jsx");

test("public registration offers only new and transferring residents", () => {
  assert.deepEqual([...chooser.matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]), ["resident", "transfer"]);
  assert.match(chooser, /to: "\/register\/new\/step-1"/);
  assert.match(chooser, /to: "\/register\/transfer"/);
  assert.doesNotMatch(chooser, /\/register\/personnel|Health personnel account|FORM C/);
});

test("Hero notice offers resident-only registration and identifies personnel accounts as internal", () => {
  const hero = source("features/landing/components/Hero.jsx");
  const eligibility = hero.match(/Public resident registration<\/p>\s*<ul[^>]*>\s*\{\[([\s\S]*?)\]\.map/);
  assert.ok(eligibility, "the public resident eligibility notice must remain present");
  assert.deepEqual([...eligibility[1].matchAll(/\["([^"]+)",/g)].map((match) => match[1]), ["Bona fide residents", "Transferees"]);
  assert.match(hero, /to="\/register"[\s\S]*?>\s*Register as Resident/);
  assert.match(hero, /Health personnel accounts are created internally by authorized\s+administrators, not through public registration\./);
  assert.doesNotMatch(hero, /to="\/register\/personnel"/);
});

test("a bookmarked personnel registration URL redirects without importing the public form", () => {
  assert.doesNotMatch(routes, /PersonnelRegistration/);
  assert.match(routes, /path="\/register\/personnel"\s+element=\{<Navigate to="\/register" replace \/>\}/);
  assert.match(routes, /path="\/register\/new\/step-1"\s+element=\{<NewResidentRegistration \/>\}/);
  assert.match(routes, /path="\/register\/transfer"\s+element=\{<TransferRegistration \/>\}/);
});

test("personnel management is inside the admin guard and general user management remains separate", () => {
  const adminRoutes = routes.slice(routes.indexOf("{/* Admin */}"), routes.indexOf("{/* Catch-all */}"));
  assert.match(adminRoutes, /ProtectedRoute allow=\{ROUTE_ROLES\.admin\}/);
  assert.match(adminRoutes, /path="users"\s+element=\{<UserManagement key="users" \/>\}/);
  assert.match(adminRoutes, /path="personnel"\s+element=\{<UserManagement personnelOnly key="personnel" \/>\}/);
  const nav = source("lib/navConfig.js");
  const adminNav = nav.slice(nav.indexOf("admin: ["));
  assert.match(adminNav, /label: "Users & Personnel",[\s\S]*?label: "Health Personnel",[\s\S]*?path: "\/app\/admin\/personnel",\s+permission: "accounts.view"/);
  assert.doesNotMatch(nav.slice(0, nav.indexOf("admin: [")), /\/app\/admin\/personnel/);
});

test("admin sidebar keeps six direct links in four visual sections", () => {
  const adminNav = source("lib/navConfig.js").split("admin: [")[1].split("export const profilePathForRole")[0];
  for (const group of ["Overview", "Administration", "Configuration", "Monitoring"]) {
    assert.match(adminNav, new RegExp(`group: "${group}"`));
  }
  assert.match(adminNav, /label: "Dashboard",[\s\S]*?group: "Overview"/);
  assert.match(adminNav, /label: "Users & Personnel",[\s\S]*?group: "Administration"/);
  assert.match(adminNav, /label: "Barangays & Access",[\s\S]*?group: "Administration"/);
  assert.match(adminNav, /label: "Health & System Settings",[\s\S]*?group: "Configuration"/);
  assert.match(adminNav, /label: "Audit Trail",[\s\S]*?group: "Monitoring"/);
  assert.match(adminNav, /label: "System Logs",[\s\S]*?group: "Monitoring"/);
  assert.doesNotMatch(adminNav, /\bchildren:/);
});

test("legacy PHN and Health Supervisor review routes remain intact", () => {
  assert.match(routes, /path="account-approvals"\s+element=\{<StaffAccountApprovals \/>\}/);
  assert.match(routes, /to="\/app\/health_supervisor\/verifications\?tab=accounts"/);
  const legacy = source("features/accounts/pages/StaffAccountApprovals.jsx");
  assert.match(legacy, /health_supervisor:\s*\[/);
  assert.match(legacy, /roles: \["bhw"\]/);
  assert.match(legacy, /phn:\s*\[/);
  assert.match(legacy, /roles: \["health_supervisor"\]/);
  assert.match(legacy, /roles: \["rhu_personnel"\]/);
  assert.doesNotMatch(legacy, /admin:\s*\[/);
});

test("personnel deletion is hidden while general deletion and identity safeguards remain", () => {
  assert.match(management, /canDelete = !personnelOnly && isAdmin && can\("accounts.delete"\)/);
  assert.match(management, /typed\.trim\(\)\.toLowerCase\(\) === String\(target.email/);
  assert.match(management, /canManageRoles=\{canManageRoles && modalTarget.id !== currentUser\?\.id\}/);
  assert.match(management, /initial\?\.roleId === "resident" \|\| initial\?\.roleId === "resident-limited"/);
  assert.match(management, /setDeleteError\(error\?\.message/);
});

test("new personnel creation cannot select an active status or administrator-set password", () => {
  const form = management.slice(management.indexOf("function AccountModal("), management.indexOf("function AccountIdentity("));
  assert.doesNotMatch(form, /Initial status|account-status|status: form.status/);
  assert.match(form, /approvalStatus: form.approvalStatus/);
  assert.match(form, /activate: canDeactivate && form.activate/);
  assert.match(form, /Create and Approve/);
  assert.match(form, /Save Pending/);
  assert.match(form, /operationId: operation.current.id/);
  assert.match(form, /disabled=\{!canDeactivate\}/);
  assert.doesNotMatch(form, /type="password"|password:\s*form/);
  assert.match(management, /Dialog\.Content/);
  assert.match(management, /lifecycleState: lifecycleFilter/);
  assert.match(management, /personnelOnly: personnelOnly \|\| undefined/);
});

test("history consumes canonical API camel-case events and refreshes the real account", () => {
  assert.match(management, /usersApi.history\(target.id\), usersApi.get\(target.id\)/);
  assert.match(management, /formatTimestamp\(entry.createdAt\)/);
  assert.match(management, /entry.eventType/);
  assert.match(management, /entry.sentAt/);
  assert.match(management, /entry.lastErrorCode/);
  assert.match(management, /auditActorLabel\(entry\)/);
  assert.doesNotMatch(management, /entry.created_at|entry.event_type|entry.sent_at/);
});

test("password setup keeps the existing reset route and verified bearer-only own-account API", () => {
  assert.match(routes, /path="\/reset-password"\s+element=\{<ResetPassword \/>\}/);
  assert.doesNotMatch(routes, /\/accept-invite|\/personnel-setup/);
  const authContext = source("context/AuthContext.jsx");
  assert.match(authContext, /RECOVERY_PATH = '\/reset-password'/);
  const authApi = source("services/api/authApi.js");
  assert.match(authApi, /personnelSetupStatus: \(token\) => api.get\('\/auth\/personnel\/setup-status'/);
  assert.match(authApi, /personnelPasswordSetup: \(password, token\) => api.post\('\/auth\/personnel\/password-setup', \{ password \}/);
  assert.match(authApi, /Authorization: `Bearer \$\{token\}`/);
  const reset = source("features/authentication/pages/ResetPassword.jsx");
  assert.match(reset, /const outcome = await saveResetPassword/);
  assert.match(reset, /setStatus\("done"\)/);
  assert.ok(reset.indexOf("const outcome = await saveResetPassword(") < reset.indexOf('setStatus("done")'));
  assert.ok(reset.indexOf('setStatus("done")') < reset.indexOf("await supabase.auth.signOut()"));
  assert.match(reset, /if \(passwordWasSaved\(failure\)\)/);
});

test("creation clears its stored retry reference only after a confirmed account response and binds the real session", () => {
  assert.match(management, /await personnelCreationOperation\(operation.current, payload, actorId\)/);
  assert.match(management, /auth.session.user\?\.id !== creationOperation\?\.actorId/);
  assert.match(management, /Authorization: `Bearer \$\{auth.session.access_token\}`/);
  assert.match(management, /if \(!result\?\.user\?\.id\)/);
  assert.ok(management.indexOf("if (!result?.user?.id)") < management.indexOf("clearPersonnelCreationOperation(creationOperation)"));
  assert.match(management, /Keep this page open and retry with unchanged details/);
});

test("persistent request references are CREATE-only, never profile edits or lifecycle actions", () => {
  const form = management.slice(management.indexOf("function AccountModal("), management.indexOf("function AccountIdentity("));
  const validateStart = form.indexOf("const validate = async");
  const validateEnd = form.indexOf("\n  return (", validateStart);
  assert.ok(validateStart >= 0 && validateEnd > validateStart);
  const validate = form.slice(validateStart, validateEnd);
  const createStart = validate.indexOf("if (isNew) {");
  const editStart = validate.indexOf("const patch = {", createStart);
  assert.ok(createStart >= 0 && editStart > createStart);
  assert.match(validate.slice(createStart, editStart), /await personnelCreationOperation\(operation.current, payload, actorId\)/);
  assert.match(validate.slice(editStart), /personnelOperation\(operation.current, patch\)/);
  assert.doesNotMatch(validate.slice(editStart), /personnelCreationOperation|clearPersonnelCreationOperation|sessionStorage/);
  const lifecycle = management.slice(management.indexOf("function LifecycleDialog("), management.indexOf("function AccountModal("));
  assert.match(lifecycle, /personnelOperation\(operation.current, payload\)/);
  assert.doesNotMatch(lifecycle, /personnelCreationOperation|clearPersonnelCreationOperation|sessionStorage/);
});
