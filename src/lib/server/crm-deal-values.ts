/** CRM_DEAL_VALUES_ENABLED=true turns on the value of each deal in the pipeline (Plan 11, PR 4c). Off by default. */
export function crmDealValuesEnabled(env: Record<string, string | undefined> = process.env) {
  return String(env.CRM_DEAL_VALUES_ENABLED || '').trim().toLowerCase() === 'true';
}
