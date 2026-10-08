import test from "node:test";
import assert from "node:assert/strict";

import { NAV, filterNavByPermission, navPermissionsForPath } from "../src/lib/navConfig.js";

const findItem = (items, label) => {
  for (const item of items) {
    if (item.label === label) return item;
    const nested = item.children && findItem(item.children, label);
    if (nested) return nested;
  }
  return undefined;
};

const collectPaths = (items) => items.flatMap((item) => [
  ...(item.path ? [item.path] : []),
  ...(item.children ? collectPaths(item.children) : []),
]);

test("Health Supervisor consultation navigation uses its view permission", () => {
  const consultation = findItem(NAV.health_supervisor, "Consultation");
  assert.equal(consultation.permission, "consultation.requests.view");
  assert.deepEqual(
    navPermissionsForPath(NAV.health_supervisor, "/app/health_supervisor/consultations"),
    ["consultation.requests.view"],
  );
});

test("permission-filtered navigation stays hidden unless the required permission is granted", () => {
  const nav = filterNavByPermission(NAV.health_supervisor, (permission) => (
    permission === "consultation.requests.approve"
  ));
  assert.equal(findItem(nav, "Consultation"), undefined);
});

test("Health Supervisor navigation keeps the requested groups and existing child routes", () => {
  const [main, healthOperations, monitoring, account] = NAV.health_supervisor
    .filter((item) => !item.hidden)
    .reduce((groups, item) => {
      const last = groups[groups.length - 1];
      if (item.group && last?.group === item.group) last.items.push(item);
      else groups.push({ group: item.group, items: [item] });
      return groups;
    }, []);

  assert.equal(main.group, "Main");
  assert.deepEqual(main.items.map((item) => item.label), ["Dashboard", "Resident Directory"]);
  assert.equal(healthOperations.group, "Health Operations");
  assert.deepEqual(
    healthOperations.items[0].children.map((item) => item.label),
    ["Consultation", "Records", "Referrals", "Health Services / Programs"],
  );
  assert.equal(healthOperations.items[0].children[1].children[0].path, "/app/health_supervisor/tcls");
  assert.equal(healthOperations.items[0].children[1].children[1].path, "/app/health_supervisor/m1");
  assert.equal(monitoring.group, "Monitoring");
  assert.equal(monitoring.items[0].label, "Monitoring & Reports");
  assert.deepEqual(monitoring.items[0].children.map((item) => item.label), ["Early Warning", "Reports"]);
  assert.equal(account.group, "Account");
  assert.deepEqual(account.items.map((item) => item.label), ["Notifications"]);

  const paths = collectPaths(NAV.health_supervisor);
  [
    "/app/health_supervisor/dashboard",
    "/app/health_supervisor/residents",
    "/app/health_supervisor/consultations",
    "/app/health_supervisor/tcls",
    "/app/health_supervisor/m1",
    "/app/health_supervisor/immunization",
    "/app/health_supervisor/tb",
    "/app/health_supervisor/followups",
    "/app/health_supervisor/referrals",
    "/app/health_supervisor/services",
    "/app/health_supervisor/trends",
    "/app/health_supervisor/reports",
    "/app/health_supervisor/notifications",
  ].forEach((path) => assert.ok(paths.includes(path), `${path} remains directly navigable`));
});

test("hidden verification route keeps its existing permission mapping", () => {
  const verification = findItem(NAV.health_supervisor, "Verifications & Approvals");
  assert.equal(verification.hidden, true);
  assert.deepEqual(
    navPermissionsForPath(NAV.health_supervisor, "/app/health_supervisor/verifications"),
    verification.anyPermissions,
  );

  const nav = filterNavByPermission(NAV.health_supervisor, (permission) => (
    permission === "households.verify"
  ));
  assert.equal(findItem(nav, "Verifications & Approvals").hidden, true);
});
