import { z } from 'zod';
import { canonicalSha256 } from '@/lib/messaging-contracts';

/** Collaboration assignment the model may submit for human review. op assign
 * targets another member (owner/admin) or self on an unassigned lead
 * (member); claim reserves for minutes; release frees the claim. The lead
 * must have been observed via crm.collaboration. Never reopens threads. */
export const coworkCrmAssignSchema = z.object({
  leadId: z.string().uuid(),
  op: z.enum(['assign', 'claim', 'release']),
  assignedToUserId: z.string().uuid().optional(),
  minutes: z.number().int().min(1).max(60).default(15),
}).strict().superRefine((value, context) => {
  if (value.op === 'assign' && !value.assignedToUserId) {
    context.addIssue({ code: 'custom', path: ['assignedToUserId'], message: 'Asignar requiere el miembro destino.' });
  }
  if (value.op !== 'assign' && value.assignedToUserId) {
    context.addIssue({ code: 'custom', path: ['assignedToUserId'], message: 'Solo asignar lleva destino.' });
  }
});
export type CoworkCrmAssign = z.infer<typeof coworkCrmAssignSchema>;

/** Manual exception triage the model may submit for human review. Only open
 * exceptions observed via exceptions.list; resolution never invents a fix,
 * it records the reviewed outcome with its reason. */
export const coworkExceptionResolveSchema = z.object({
  exceptionId: z.string().uuid(),
  action: z.enum(['resolved', 'dismissed']),
  reason: z.string().trim().min(3).max(500),
}).strict();
export type CoworkExceptionResolve = z.infer<typeof coworkExceptionResolveSchema>;

/** Mission pause/resume the model may submit for human review. Only the
 * owner's own missions observed via missions.list. Pausing completes pending
 * prospecting/contact tasks exactly like the app's manual pause. */
export const coworkMissionControlSchema = z.object({
  missionId: z.string().uuid(),
  targetStatus: z.enum(['paused', 'active']),
}).strict();
export type CoworkMissionControl = z.infer<typeof coworkMissionControlSchema>;

export function hashCoworkCrmAssignProposal(op: CoworkCrmAssign['op'], payload: unknown) {
  return canonicalSha256({ kind: `crm_assign_${op}`, payload });
}
export function hashCoworkExceptionProposal(payload: unknown) {
  return canonicalSha256({ kind: 'exception_resolve', payload });
}
export function hashCoworkMissionProposal(payload: unknown) {
  return canonicalSha256({ kind: 'mission_control', payload });
}
