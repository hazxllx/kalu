import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  loadRiskClusters,
  mapServerRiskLevel,
  toRiskCluster,
} from "../../src/features/households/lib/riskClusterAdapter.js";
import { RISK_LEVELS } from "../../src/lib/householdRisk.js";

const fixture = (id, level, environmentalLevel = "High") => ({
  id,
  headName: `${id} Head`,
  barangay: "San Isidro",
  riskLevel: environmentalLevel,
  riskScore: 75,
  riskFactors: ["Unsafe water source"],
});

test("HH-TEST-021..024 preserve each explicit four-tier cluster assignment", () => {
  const cases = [
    ["HH-TEST-021", RISK_LEVELS.PRIORITY],
    ["HH-TEST-022", RISK_LEVELS.INTERVENTION],
    ["HH-TEST-023", RISK_LEVELS.MONITOR],
    ["HH-TEST-024", RISK_LEVELS.STABLE],
  ];
  for (const [id, level] of cases) {
    const cluster = toRiskCluster(fixture(id, level), { riskClusterLevel: level });
    assert.equal(cluster.id, id);
    assert.equal(cluster.risk.level, level);
    assert.equal(cluster.riskClusterLevel, level);
    assert.equal(cluster.environmentalRisk.level, "High");
  }
});

test("missing and invalid assignments stay neutral instead of becoming Stable", () => {
  assert.equal(mapServerRiskLevel("High"), null);
  assert.equal(mapServerRiskLevel("not-a-cluster"), null);
  assert.equal(toRiskCluster(fixture("HH-TEST-021", null), null).risk.level, RISK_LEVELS.UNASSESSED);
  assert.equal(
    toRiskCluster(fixture("HH-TEST-022", "invalid"), { riskClusterLevel: "invalid" }).risk.level,
    RISK_LEVELS.UNASSESSED,
  );
});

test("household cluster loading paginates and batches persisted assignments", async () => {
  const pages = [
    { rows: [fixture("HH-TEST-021", RISK_LEVELS.PRIORITY), fixture("HH-TEST-022", RISK_LEVELS.INTERVENTION)], total: 4 },
    { rows: [fixture("HH-TEST-023", RISK_LEVELS.MONITOR), fixture("HH-TEST-024", RISK_LEVELS.STABLE)], total: 4 },
  ];
  const listCalls = [];
  const workflowCalls = [];
  const assignments = {
    "HH-TEST-021": RISK_LEVELS.PRIORITY,
    "HH-TEST-022": RISK_LEVELS.INTERVENTION,
    "HH-TEST-023": RISK_LEVELS.MONITOR,
    "HH-TEST-024": RISK_LEVELS.STABLE,
  };
  const clusters = await loadRiskClusters({
    pageSize: 2,
    concurrency: 2,
    listHouseholds: async ({ limit, offset }) => {
      listCalls.push({ limit, offset });
      return pages[offset / 2];
    },
    getWorkflow: async (id) => {
      workflowCalls.push(id);
      return { riskClusterLevel: assignments[id] };
    },
    includeWorkflow: true,
  });
  assert.deepEqual(listCalls, [{ limit: 2, offset: 0 }, { limit: 2, offset: 2 }]);
  assert.deepEqual(workflowCalls.sort(), Object.keys(assignments).sort());
  assert.deepEqual(clusters.map((row) => row.risk.level), [
    RISK_LEVELS.PRIORITY,
    RISK_LEVELS.INTERVENTION,
    RISK_LEVELS.MONITOR,
    RISK_LEVELS.STABLE,
  ]);
});

test("household cluster loading rejects incomplete or inconsistent list pages", async () => {
  await assert.rejects(
    loadRiskClusters({ listHouseholds: async () => ({ rows: [], total: undefined }) }),
    /incomplete page or total count/,
  );
  await assert.rejects(
    loadRiskClusters({ pageSize: 2, listHouseholds: async () => ({ rows: [fixture("HH-TEST-021", "priority")], total: 2 }) }),
    /short page before the total count/,
  );
});

test("clearing an assignment overrides the stale household list value immediately", () => {
  const household = { ...fixture("HH-TEST-021"), riskClusterLevel: RISK_LEVELS.PRIORITY };
  assert.equal(toRiskCluster(household).risk.level, RISK_LEVELS.PRIORITY);
  assert.equal(toRiskCluster(household, { riskClusterLevel: null }).risk.level, RISK_LEVELS.UNASSESSED);
  assert.equal(toRiskCluster(household, { riskClusterLevel: "invalid" }).risk.level, RISK_LEVELS.UNASSESSED);
});

test("duplicate, missing or changing pages cannot masquerade as a complete cluster distribution", async () => {
  const row = { ...fixture("HH-TEST-021"), riskClusterLevel: RISK_LEVELS.PRIORITY };
  for (const pages of [
    [null], [{ rows: [], total: 1 }], [{ rows: [row], total: 2 }],
    [{ rows: [row], total: 1.5 }], [{ rows: [{ ...row, id: null }], total: 1 }],
    [{ rows: [row, row], total: 2 }],
    [{ rows: [row, { ...row, id: "HH-TEST-022" }], total: 3 }, { rows: [row], total: 3 }],
    [{ rows: [row, { ...row, id: "HH-TEST-022" }], total: 3 }, { rows: [{ ...row, id: "HH-TEST-023" }], total: 4 }],
  ]) {
    await assert.rejects(loadRiskClusters({ pageSize: 2, listHouseholds: async ({ offset }) => pages[offset / 2] }), /Household list/);
  }
  assert.deepEqual(await loadRiskClusters({ listHouseholds: async () => ({ rows: [], total: 0 }) }), []);
});

test("MHO summary accepts exact counts and rejects unavailable or inconsistent API payloads", async () => {
  const source = await readFile(new URL("../../src/services/api/householdRiskApi.js", import.meta.url), "utf8");
  const createApi = new Function("api", "RISK_LEVELS", source.replace(/^import .*;$/gm, "")
    .replace("export const householdRiskApi", "const householdRiskApi")
    .replace("export default householdRiskApi;", "return householdRiskApi;"));
  const valid = { totalHouseholds: 6, classifiedHouseholds: 4,
    riskDistribution: Object.values(RISK_LEVELS).map((name) => ({ name, value: name === RISK_LEVELS.UNASSESSED ? 2 : 1 })) };
  const api = (payload) => createApi({ get: async (path) => { assert.equal(path, "/households/risk-clusters/summary"); return payload; } }, RISK_LEVELS);
  assert.deepEqual(await api(valid).getClusterSummary(), valid);
  const empty = { totalHouseholds: 0, classifiedHouseholds: 0, riskDistribution: valid.riskDistribution.map((row) => ({ ...row, value: 0 })) };
  assert.deepEqual(await api(empty).getClusterSummary(), empty);
  const malformed = [null, {}, { ...valid, totalHouseholds: -1 }, { ...valid, classifiedHouseholds: 0 }];
  for (const change of [
    (value) => value.riskDistribution.pop(),
    (value) => { value.riskDistribution[0].name = value.riskDistribution[1].name; },
    (value) => { value.riskDistribution[0].value = "1"; },
    (value) => { value.riskDistribution[0].value = 0.5; },
    (value) => { value.riskDistribution[0].value = -1; },
    (value) => { value.totalHouseholds = 7; },
  ]) {
    const payload = structuredClone(valid);
    change(payload);
    malformed.push(payload);
  }
  for (const payload of malformed) await assert.rejects(api(payload).getClusterSummary(), /unavailable or incomplete/);
});
