import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkCapability } from '@/lib/cowork/capabilities';
import { queryCoworkLeads } from './lead-tools';
import { queryCoworkExtendedReads, type CoworkExtendedReadAction } from './extended-reads';
import { readCoworkResearch } from './research-read';

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
  ];
}
