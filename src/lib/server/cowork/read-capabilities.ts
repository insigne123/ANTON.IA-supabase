import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkCapability } from '@/lib/cowork/capabilities';
import { countCoworkLeads, queryCoworkLeads, summarizeCoworkLeads } from './lead-tools';
import { queryCoworkExtendedReads, readCoworkFileContent, type CoworkExtendedReadAction } from './extended-reads';
import { readCoworkResearch } from './research-read';
import { readCoworkSavedSearches } from './saved-searches';
import { readCoworkProfile } from './profile-read';
import { readCoworkIcp } from './icp-read';
import { readCoworkLeadRecommendations } from './lead-recommend-read';
import { readCoworkOpportunities } from './opportunities-read';
import { COWORK_DOMAIN_FIXED_READS, COWORK_DOMAIN_ENTITY_READS } from '@/lib/cowork/domain-reads';
import { queryCoworkContactabilityBatch, queryCoworkDomainRead } from './domain-reads';
import { readCoworkBatchReport, readCoworkCompanyPlan, readCoworkNextTouch, readCoworkRetryReview } from './batch-reads';
import { readCoworkLinkedinFollowups, readCoworkLinkedinInbox, readCoworkLinkedinJobs, readCoworkLinkedinNetwork, readCoworkLinkedinQuota } from './linkedin-reads';
import { readContactedAccount, readMeetingChain, readRepliesAttention, readRepliesStalled } from './reply-reads';
import { readMetricsChannels, readMetricsDiagnose, readMetricsIncidents, readMetricsRates } from './metric-reads';
import { readDeliverabilityBounces, readDeliverabilityCheck, readDeliverabilitySender } from './deliverability-reads';
import { readComplianceCheck, readComplianceLaw, readComplianceObligation } from './compliance-reads';

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
      name: 'profile.get', version: 1, effect: 'read', description: 'Identidad comercial propia (lo que guardó en Perfil y sus firmas), no verifica mailbox',
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
      description: 'Contactos propios por texto o URL exacta de perfil LinkedIn; una URL no trae coincidencias de otras personas. «con correo» deja solo a quienes tienen correo y «con LinkedIn», solo a quienes tienen perfil de LinkedIn guardado, en toda la cuenta y no solo entre los más recientes',
      input: z.string().max(500), output: z.unknown(),
      execute: input => queryCoworkLeads(client, scope, 'leads.search', input as string),
    },
    {
      name: 'icp.analyze', version: 1, effect: 'read',
      description: 'Cliente ideal: lo declarado en Perfil frente a los resultados de los envíos, por segmento, y cuántos contactos guardados calzan',
      input: z.string().max(300), output: z.unknown(),
      execute: input => readCoworkIcp(client, scope, input as string),
    },
    {
      name: 'leads.recommend', version: 1, effect: 'read',
      description: 'A quién escribir: contactos guardados sin contactar, ordenados por calce con la oferta o el cliente ideal y por preparación',
      input: z.string().max(300), output: z.unknown(),
      execute: input => readCoworkLeadRecommendations(client, scope, input as string),
    },
    {
      name: 'opportunities.list', version: 1, effect: 'read',
      description: 'Oportunidades comerciales de la organización (empresas contratando, licitaciones y proyectos del SEIA) con su señal, fuente y fecha; solo cuentas con acceso',
      input: z.string().max(200), output: z.unknown(),
      execute: input => readCoworkOpportunities(client, scope, input as string),
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
      name: 'campaigns.retry_review', version: 1, effect: 'read', description: 'Qué envíos se pueden reintentar, cuáles no y cuáles hay que revisar primero en Contactados',
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
      name: 'compliance.check', version: 1, effect: 'read', description: 'Política transversal persona/cuenta antes de contactar, por UUID',
      input: z.string().uuid(), output: z.unknown(), execute: input => readComplianceCheck(client, scope, input as string),
    },
    {
      name: 'compliance.law', version: 1, effect: 'read', description: 'Marco chileno de contacto comercial con fechas y fuentes',
      input: z.literal(''), output: z.unknown(), execute: () => readComplianceLaw(),
    },
    {
      name: 'compliance.obligation', version: 1, effect: 'read', description: 'Obligaciones que presionan al comprador por industria',
      input: z.string().max(120), output: z.unknown(), execute: input => readComplianceObligation(input as string),
    },
    {
      name: 'deliverability.check', version: 1, effect: 'read', description: 'SPF, DKIM, DMARC y MX de un dominio remitente',
      input: z.string().max(120), output: z.unknown(), execute: input => readDeliverabilityCheck(client, scope, input as string),
    },
    {
      name: 'leads.count', version: 1, effect: 'read', description: 'Cuenta exacta de tus contactos guardados que calzan con uno o varios términos (separados por |)',
      input: z.string().max(120), output: z.unknown(), execute: input => countCoworkLeads(client, scope, input as string),
    },
    {
      name: 'leads.summary', version: 1, effect: 'read', description: 'Tus contactos guardados por estado (respondieron, contactados, listos, con correo, sin correo), con cifras exactas y el siguiente paso de cada grupo',
      input: z.literal(''), output: z.unknown(), execute: () => summarizeCoworkLeads(client, scope),
    },
    {
      name: 'site.read', version: 1, effect: 'read', description: 'Texto público del sitio web de la empresa (el de Perfil si no se da uno)',
      input: z.string().max(200), output: z.unknown(),
      execute: async input => (await import('./site-read')).readCoworkSite(client, scope, input as string),
    },
    {
      name: 'deliverability.bounces', version: 1, effect: 'read', description: 'Causas de rebote contra el umbral del 2%',
      input: z.literal(''), output: z.unknown(), execute: () => readDeliverabilityBounces(client, scope),
    },
    {
      name: 'deliverability.sender', version: 1, effect: 'read', description: 'Identidad declarada contra cabeceras de envíos reales',
      input: z.literal(''), output: z.unknown(), execute: () => readDeliverabilitySender(client, scope),
    },
    {
      name: 'metrics.rates', version: 1, effect: 'read', description: 'Tasas con período, denominador y origen por métrica',
      input: z.literal(''), output: z.unknown(), execute: () => readMetricsRates(client, scope),
    },
    {
      name: 'metrics.diagnose', version: 1, effect: 'read', description: 'Hipótesis de rendimiento probadas contra datos',
      input: z.literal(''), output: z.unknown(), execute: () => readMetricsDiagnose(client, scope),
    },
    {
      name: 'metrics.channels', version: 1, effect: 'read', description: 'Comparación email/LinkedIn sin generalizar sin denominadores',
      input: z.literal(''), output: z.unknown(), execute: () => readMetricsChannels(client, scope),
    },
    {
      name: 'metrics.incidents', version: 1, effect: 'read', description: 'Fallas sistémicas con qué hacer en cada una',
      input: z.literal(''), output: z.unknown(), execute: () => readMetricsIncidents(client, scope),
    },
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
    extended('app.context', 'Conexiones de correo, volúmenes y oferta (de Perfil o de la organización), sin entrada'),
    extended('draft.get', 'Versión vigente de un borrador propio con su hash de contenido, por UUID'),
    extended('campaigns.list', 'Campañas propias con estado y destinatarios, sin entrada'),
    extended('files.list', 'Archivos subidos (nombre, trabajo, tamaño), sin contenido'),
    {
      name: 'files.read', version: 1, effect: 'read',
      description: 'Contenido acotado de un archivo subido (CSV, JSON, Excel, PDF, Word, Markdown o texto), por nombre y, en un Excel, «archivo.xlsx#Hoja»; no ejecuta nada',
      input: z.string().trim().min(1).max(160), output: z.unknown(),
      execute: input => readCoworkFileContent(client, scope, input as string),
    },
  ];
}
