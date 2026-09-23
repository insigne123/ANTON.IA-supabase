import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkCapability } from '@/lib/cowork/capabilities';
import { queryCoworkLeads } from './lead-tools';
import { queryCoworkExtendedReads, type CoworkExtendedReadAction } from './extended-reads';
import { readCoworkResearch } from './research-read';
import { readCoworkSavedSearches } from './saved-searches';
import { readCoworkProfile } from './profile-read';
import { COWORK_DOMAIN_FIXED_READS, COWORK_DOMAIN_ENTITY_READS } from '@/lib/cowork/domain-reads';
import { queryCoworkContactabilityBatch, queryCoworkDomainRead } from './domain-reads';
import { readCoworkBatchReport, readCoworkCompanyPlan, readCoworkNextTouch, readCoworkRetryReview } from './batch-reads';
import { readCoworkLinkedinFollowups, readCoworkLinkedinInbox, readCoworkLinkedinJobs, readCoworkLinkedinNetwork, readCoworkLinkedinQuota } from './linkedin-reads';
import { readContactedAccount, readMeetingChain, readRepliesAttention, readRepliesStalled } from './reply-reads';

type Scope = { userId: string; organizationId: string };

/** Read-only capabilities executed through the durable operation ledger. */
export function coworkReadCapabilities(
  client: SupabaseClient,
  scope: Scope,
): readonly CoworkCapability[] {
  const textInput = z.string().max(200);
  const extended = (name: CoworkExtendedReadAction, description: string): CoworkCapability => ({
    name, version: 1, effect: 'read',
    description,
    input: textInput, output: z.unknown(),
    execute: input => queryCoworkExtendedReads(client, scope, name, input as string),
  });
  return [
    {
      name: 'lists.review_batch', version: 1, effect: 'read', description: 'Revisar hasta cinco contactos sin enriquecer ni enviar',
      input: z.string().max(400), output: z.unknown(),
      execute: async input => {
        const ids = z.array(z.string().uuid()).min(1).max(5).parse(JSON.parse(input as string));
        if (new Set(ids).size !== ids.length) throw new Error('Hay contactos duplicados en la selección.');
        const { reviewCoworkListContact } = await import('./list-review');
        const items = [];
        for (const id of ids) items.push(await reviewCoworkListContact(client, scope, id, async () =>
          await queryCoworkDomainRead(client, scope, 'privacy.contactability', id) as { status?: string; reasons?: string[] }));
        items.sort((a, b) => Number(a.disposition === 'blocked') - Number(b.disposition === 'blocked') || a.priority.rank - b.priority.rank || a.leadId.localeCompare(b.leadId));
        return { scope: 'organization_list_review', items, returned: items.length, sendAuthorized: false };
      },
    },
    ...[...COWORK_DOMAIN_FIXED_READS, ...COWORK_DOMAIN_ENTITY_READS].map((name): CoworkCapability => ({
      name, version: 1, effect: 'read', description: `Consulta de dominio ${name} con alcance vigente`,
      input: COWORK_DOMAIN_FIXED_READS.some(action => action === name) ? z.literal('') : z.string().uuid(),
      output: z.unknown(), execute: input => queryCoworkDomainRead(client, scope, name, input as string),
    })),
    {
      name: 'privacy.contactability_batch', version: 1, effect: 'read',
      description: 'Restricciones de hasta 5 contactos observados, una sola operación; informativa',
      input: z.string().max(400), output: z.unknown(),
      execute: input => queryCoworkContactabilityBatch(client, scope, JSON.parse(input as string)),
    },
    {
      name: 'profile.get', version: 1, effect: 'read', description: 'Identidad comercial propia, no verifica mailbox',
      input: z.literal(''), output: z.unknown(), execute: input => readCoworkProfile(client, scope, input as string),
    },
    {
      name: 'saved_searches.list', version: 1, effect: 'read',
      description: 'Búsquedas guardadas propias y compartidas de la organización, sin ejecutarlas',
      input: z.literal(''), output: z.unknown(),
      execute: input => readCoworkSavedSearches(client, scope, input as string),
    },
    {
      name: 'leads.search', version: 1, effect: 'read',
      description: 'Contactos guardados propios que coinciden con un texto',
      input: textInput, output: z.unknown(),
      execute: input => queryCoworkLeads(client, scope, 'leads.search', input as string),
    },
    {
      name: 'leads.get', version: 1, effect: 'read',
      description: 'Contacto guardado propio por UUID',
      input: textInput, output: z.unknown(),
      execute: input => queryCoworkLeads(client, scope, 'leads.get', input as string),
    },
    {
      name: 'research.get_existing', version: 1, effect: 'read',
      description: 'Investigación guardada de un contacto propio por UUID',
      input: textInput, output: z.unknown(),
      execute: input => readCoworkResearch(client, scope, input as string),
    },
    {
      name: 'campaigns.batch_report', version: 1, effect: 'read', description: 'Cada envío y toque de tu campaña con estado y frenos',
      input: z.string().uuid(), output: z.unknown(),
      execute: input => readCoworkBatchReport(client, scope, input as string),
    },
    {
      name: 'campaigns.next_touch', version: 1, effect: 'read', description: 'Siguiente toque elegible por destinatario en hora de Santiago',
      input: z.string().uuid(), output: z.unknown(),
      execute: input => readCoworkNextTouch(client, scope, input as string),
    },
    {
      name: 'campaigns.retry_review', version: 1, effect: 'read', description: 'Qué se puede reintentar, qué es terminal y qué debe conciliarse',
      input: z.string().uuid(), output: z.unknown(),
      execute: input => readCoworkRetryReview(client, scope, input as string),
    },
    {
      name: 'campaigns.company_plan', version: 1, effect: 'read', description: 'Día asignado por destinatario, una empresa por día',
      input: z.string().uuid(), output: z.unknown(),
      execute: input => readCoworkCompanyPlan(client, scope, input as string),
    },
    {
      name: 'linkedin.network', version: 1, effect: 'read', description: 'Red LinkedIn observada con cobertura de barrido',
      input: z.literal(''), output: z.unknown(),
      execute: () => readCoworkLinkedinNetwork(client, scope),
    },
    {
      name: 'linkedin.inbox', version: 1, effect: 'read', description: 'Bandeja LinkedIn observada; pendientes solo con barrido completo',
      input: z.literal(''), output: z.unknown(),
      execute: input => readCoworkLinkedinInbox(client, scope, input as string),
    },
    {
      name: 'linkedin.quota', version: 1, effect: 'read', description: 'Cupo semanal de invitaciones contando pendientes',
      input: z.literal(''), output: z.unknown(),
      execute: () => readCoworkLinkedinQuota(client, scope),
    },
    {
      name: 'linkedin.followups', version: 1, effect: 'read', description: 'Candidatos a segundo contacto con exclusiones',
      input: z.literal(''), output: z.unknown(),
      execute: () => readCoworkLinkedinFollowups(client, scope),
    },
    {
      name: 'linkedin.jobs', version: 1, effect: 'read', description: 'Trabajos LinkedIn en cola y resultados confirmados',
      input: z.literal(''), output: z.unknown(),
      execute: () => readCoworkLinkedinJobs(client, scope),
    },
    extended('crm.search', 'CRM del equipo (toda la organización) que coincide con un texto'),
    extended('crm.get_lead', 'Ficha CRM con historial de contactados, por UUID'),
    {
      name: 'replies.attention', version: 1, effect: 'read', description: 'Rebotes, bloqueos y respuestas sin clasificar con acción recomendada',
      input: z.literal(''), output: z.unknown(), execute: () => readRepliesAttention(client, scope),
    },
    {
      name: 'replies.stalled', version: 1, effect: 'read', description: 'Interesados sin seguimiento tras 48 horas',
      input: z.literal(''), output: z.unknown(), execute: () => readRepliesStalled(client, scope),
    },
    {
      name: 'contacted.account', version: 1, effect: 'read', description: 'Toda la cuenta: hilos y personas de la misma empresa, por UUID de contacto',
      input: z.string().uuid(), output: z.unknown(), execute: input => readContactedAccount(client, scope, input as string),
    },
    {
      name: 'replies.meeting_chain', version: 1, effect: 'read', description: 'Cadena verificable envío-respuesta-compromiso-reunión, por UUID de contacto',
      input: z.string().uuid(), output: z.unknown(), execute: input => readMeetingChain(client, scope, input as string),
    },
    extended('contacted.search', 'Historial de contactados del equipo que coincide con un texto'),
    extended('contacted.timeline', 'Historial de envíos de un contacto por UUID de ficha'),
    extended('metrics.overview', 'Métricas de la organización de los últimos 7 días, sin entrada'),
    extended('app.context', 'Conexiones de correo, volúmenes y oferta, sin entrada'),
    extended('draft.get', 'Versión vigente de un borrador propio con su hash de contenido, por UUID'),
    extended('campaigns.list', 'Campañas propias con estado y destinatarios, sin entrada'),
    extended('files.list', 'Archivos subidos para código (nombre, trabajo, tamaño), sin contenido'),
  ];
}
