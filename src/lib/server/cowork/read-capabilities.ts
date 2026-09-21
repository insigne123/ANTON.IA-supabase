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
    extended('crm.search', 'CRM del equipo (toda la organización) que coincide con un texto'),
    extended('crm.get_lead', 'Ficha CRM con historial de contactados, por UUID'),
    extended('contacted.search', 'Historial de contactados del equipo que coincide con un texto'),
    extended('contacted.timeline', 'Historial de envíos de un contacto por UUID de ficha'),
    extended('metrics.overview', 'Métricas de la organización de los últimos 7 días, sin entrada'),
    extended('app.context', 'Conexiones de correo, volúmenes y oferta, sin entrada'),
    extended('draft.get', 'Versión vigente de un borrador propio con su hash de contenido, por UUID'),
    extended('campaigns.list', 'Campañas propias con estado y destinatarios, sin entrada'),
    extended('files.list', 'Archivos subidos para código (nombre, trabajo, tamaño), sin contenido'),
  ];
}
