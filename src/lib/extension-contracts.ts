import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';
import { canonicalExtensionProfileUrl as normalizeLinkedinProfileUrl } from '@/lib/extension-profile-url';

export const ExtensionProfileSchema = z.object({
  linkedinUrl: z.string().max(2048).transform(normalizeLinkedinProfileUrl).refine(Boolean, 'URL de perfil de LinkedIn inválida.'),
  fullName: z.string().trim().max(300).default(''),
  title: z.string().trim().max(500).default(''),
  companyName: z.string().trim().max(300).default(''),
  email: z.union([z.string().trim().email().max(320), z.literal('')]).default(''),
  companyDomain: z.string().trim().max(300).default(''),
  primaryPhone: z.string().trim().max(100).default(''),
  emailStatus: z.string().trim().max(60).default('unknown'),
  details: z.object({
    headline: z.string().max(500).optional(), city: z.string().max(160).optional(),
    state: z.string().max(160).optional(), country: z.string().max(160).optional(),
    industry: z.string().max(160).optional(), seniority: z.string().max(100).optional(),
    departments: z.array(z.string().max(100)).max(20).optional(),
    companySize: z.string().max(100).optional(),
  }).strict().optional(),
}).strict();
export type ExtensionProfile = z.infer<typeof ExtensionProfileSchema>;

export const ExtensionRequestSchema = z.object({
  action: z.enum(['session', 'lookup', 'save', 'enrich', 'research', 'research-status', 'research-retry', 'phone-status', 'message', 'email-draft', 'sequence', 'campaigns', 'campaign-add', 'send-claim', 'send-result']),
  enrichmentId: z.string().trim().min(1).max(500).optional(),
  sendMessage: z.string().trim().min(1).max(1200).optional(),
  sendResult: z.object({
    id: z.string().uuid(), claimToken: z.string().uuid(),
    status: z.enum(['confirmed', 'uncertain', 'not_sent']),
    eventId: z.string().min(1).max(1000).optional(),
    threadUrl: z.string().url().max(2048).refine(value => { const url = new URL(value); return url.origin === 'https://www.linkedin.com' && url.pathname.startsWith('/messaging/thread/'); }).optional(),
    error: z.string().max(1000).optional(),
  }).strict().refine(value => value.status !== 'confirmed' || !!value.eventId).optional(),
  campaignId: z.string().uuid().optional(),
  operationId: z.string().uuid().optional(),
  campaignRevision: z.number().int().positive().optional(),
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  profile: ExtensionProfileSchema.optional(),
  replaceFields: z.boolean().default(false),
  refreshResearch: z.boolean().default(false),
  revealEmail: z.boolean().default(false),
  revealPhone: z.boolean().default(false),
  instruction: z.string().trim().max(1000).default('Iniciar una conversación profesional.'),
  language: z.enum(['es', 'en', 'pt']).default('es'),
  tone: z.enum(['profesional', 'cercano', 'directo']).default('profesional'),
  previousMessage: z.string().max(1200).default(''),
  offsets: z.array(z.number().int().min(1).max(365)).min(1).max(4).default([3, 7]),
}).strict().superRefine((body, ctx) => {
  if ((body.action === 'send-claim' && !body.sendMessage) || (body.action === 'send-result' && !body.sendResult)) {
    ctx.addIssue({ code: 'custom', message: 'Revisa el mensaje y la operación de envío.' });
  }
  if (body.action === 'campaign-add' && (!body.campaignId || !body.campaignRevision)) {
    ctx.addIssue({ code: 'custom', message: 'Selecciona una campaña y actualiza su estado.' });
  }
  if (body.action !== 'session' && (!body.organizationId || !body.userId || !body.profile)) {
    ctx.addIssue({ code: 'custom', message: 'Conecta tu cuenta y selecciona un perfil.' });
  }
  if (new Set(body.offsets).size !== body.offsets.length || body.offsets.some((n, i) => i > 0 && n <= body.offsets[i - 1])) {
    ctx.addIssue({ code: 'custom', path: ['offsets'], message: 'Los días deben ser distintos y estar en orden creciente.' });
  }
});

// Stable across users in a workspace; retries cannot create a second extension record.
export function extensionLeadId(organizationId: string, linkedinUrl: string) {
  const url = normalizeLinkedinProfileUrl(linkedinUrl);
  if (!url) throw new Error('INVALID_LINKEDIN_PROFILE');
  return uuidv5(`antonia:linkedin:${organizationId}:${url.toLowerCase()}`, uuidv5.URL);
}

export function assertExtensionScope(body: { organizationId?: string; userId?: string }, auth: { organizationId: string; user: { id: string } }) {
  if (body.organizationId !== auth.organizationId || body.userId !== auth.user.id) {
    throw new Error('EXTENSION_SESSION_CHANGED');
  }
}
