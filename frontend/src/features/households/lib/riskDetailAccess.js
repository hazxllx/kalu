/**
 * Access and data-loading separation for HouseholdRiskDetail.
 *
 * Household viewing + BHW visit history (`households.view` / `households.create`)
 * are separate from the supervisor/PHN follow-up workflow (`followups.view` /
 * `followups.edit`) so authorized BHWs never trigger a 403 on
 * `GET /households/:id/risk-workflow`.
 */

export function getHouseholdDetailAccess({ user, can }) {
  const canViewWorkflow = Boolean(can?.('followups.view'));
  const canEditWorkflow = Boolean(can?.('followups.edit'));
  const canViewVisits = Boolean(user?.role === 'bhw' && can?.('households.view'));
  const canCreateVisits = Boolean(user?.role === 'bhw' && can?.('households.create'));

  return {
    canViewWorkflow,
    canEditWorkflow,
    canViewVisits,
    canCreateVisits,
  };
}

export async function loadHouseholdDetailData({
  id,
  access,
  getHousehold,
  getWorkflow,
  listVisits,
}) {
  const res = await getHousehold(id);
  const record = res?.household || null;
  if (!record) return null;

  const [workflow, visitResult] = await Promise.all([
    access?.canViewWorkflow ? getWorkflow(id) : Promise.resolve(null),
    access?.canViewVisits ? listVisits(id) : Promise.resolve({ visits: [] }),
  ]);

  return {
    record,
    workflow: workflow || null,
    visits: Array.isArray(visitResult?.visits) ? visitResult.visits : [],
  };
}
