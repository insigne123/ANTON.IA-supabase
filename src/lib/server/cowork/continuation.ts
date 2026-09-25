import { deterministicCoworkUuid } from './operations';

/** Arguments of the cowork_admit_followup call that resumes a thread after an
 * approved action. Every argument is named, p_reset_depth included: the
 * database keeps the 6-argument version next to the 7-argument one (the budgets
 * migration added a parameter with a default instead of replacing it), and
 * without it PostgREST cannot pick one (PGRST203), so no continuation was ever
 * admitted. A continuation counts as one more automatic step of the thread. */
export function coworkContinuationArgs(scope: { userId: string; organizationId: string }, runId: string, message: string, mode: 'approval' | 'autonomous') {
  return {
    p_user_id: scope.userId, p_organization_id: scope.organizationId,
    p_request_id: deterministicCoworkUuid(`cowork:continuation:${runId}`),
    p_message: message, p_mode: mode, p_parent_run_id: runId, p_reset_depth: false,
  };
}
