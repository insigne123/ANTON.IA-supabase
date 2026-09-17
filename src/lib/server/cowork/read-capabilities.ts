import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkCapability } from '@/lib/cowork/capabilities';
import { queryCoworkLeads } from './lead-tools';
import { readCoworkResearch } from './research-read';

type Scope = { userId: string; organizationId: string };

/** Read-only capabilities executed through the durable operation ledger. */
export function coworkReadCapabilities(
  client: SupabaseClient,
  scope: Scope,
): readonly CoworkCapability[] {
  const textInput = z.string().max(200);
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
  ];
}
