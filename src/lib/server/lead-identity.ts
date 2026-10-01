import { isMaskedName, preferredFullName } from '@/lib/lead-name';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

/**
 * After the email lookup, the provider returns the person's real name, LinkedIn and title. They go back to the saved
 * contact (`leads`) and to the enriched one, so screens, research and drafts stop seeing «Rafael Du***n» and «sin
 * LinkedIn». Only gaps are filled: a hidden or empty name, an empty LinkedIn or title. Never overwrites what someone
 * typed (docs/contactos-identidad.md).
 */

export type ProviderIdentity = {
  fullName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  linkedinUrl?: unknown;
  title?: unknown;
};

function text(value: unknown, max: number) {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : '';
}

/** The provider's complete name, or null when it is still hidden or missing. */
export function providerFullName(identity: ProviderIdentity): string | null {
  const joined = [text(identity.firstName, 100), text(identity.lastName, 100)].filter(Boolean).join(' ');
  const name = preferredFullName(text(identity.fullName, 200), joined);
  return name && !isMaskedName(name) ? name : null;
}

export function identityFromProvider(extracted: Record<string, unknown> | null | undefined): ProviderIdentity {
  const data = extracted || {};
  return {
    fullName: data.full_name ?? data.name,
    firstName: data.first_name,
    lastName: data.last_name,
    linkedinUrl: data.linkedin_url,
    title: data.title,
  };
}

/** What to change on a row: only its gaps. Pure, so the rules are tested without a database. */
export function identityPatch(current: { name?: unknown; linkedinUrl?: unknown; title?: unknown }, identity: ProviderIdentity) {
  const fullName = providerFullName(identity);
  const linkedin = normalizeLinkedinProfileUrl(text(identity.linkedinUrl, 2_048) || null) || '';
  const title = text(identity.title, 160);
  const currentName = text(current.name, 200);
  return {
    name: fullName && (!currentName || isMaskedName(currentName)) && fullName !== currentName ? fullName : null,
    linkedinUrl: linkedin && !text(current.linkedinUrl, 2_048) ? linkedin : null,
    title: title && !text(current.title, 160) ? title : null,
  };
}

type Client = { from: (table: string) => any };

/**
 * Applies the provider's identity to the saved contact and to the enriched one. Each update is scoped to the person's
 * own rows (user and organization) and guarded by the value it replaces, so a concurrent edit wins.
 */
export async function applyEnrichedIdentity(client: Client, input: {
  userId: string;
  organizationId: string;
  savedLeadId?: string | null;
  enrichedLeadId?: string | null;
  /** The provider's person id of the lookup: a saved contact bound to another person is left as it is. */
  providerId?: string | null;
  identity: ProviderIdentity;
}) {
  const changed = { savedLead: [] as string[], enrichedLead: [] as string[] };
  if (input.savedLeadId) {
    const { data: saved } = await client.from('leads').select('id,name,linkedin_url,title,source_provider_id,apollo_id')
      .eq('id', input.savedLeadId).eq('user_id', input.userId).eq('organization_id', input.organizationId).maybeSingle();
    const boundIds = [saved?.source_provider_id, saved?.apollo_id].map((value) => text(value, 255)).filter(Boolean);
    const samePerson = !input.providerId || boundIds.length === 0 || boundIds.includes(text(input.providerId, 255));
    if (saved && samePerson) {
      const patch = identityPatch({ name: saved.name, linkedinUrl: saved.linkedin_url, title: saved.title }, input.identity);
      const values = {
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.linkedinUrl ? { linkedin_url: patch.linkedinUrl } : {}),
        ...(patch.title ? { title: patch.title } : {}),
      };
      if (Object.keys(values).length) {
        let update = client.from('leads').update(values)
          .eq('id', input.savedLeadId).eq('user_id', input.userId).eq('organization_id', input.organizationId);
        update = saved.name == null ? update.is('name', null) : update.eq('name', saved.name);
        const { error } = await update;
        if (!error) changed.savedLead = Object.keys(values);
      }
    }
  }
  if (input.enrichedLeadId) {
    const { data: enriched } = await client.from('enriched_leads').select('id,full_name,linkedin_url,title')
      .eq('id', input.enrichedLeadId).eq('user_id', input.userId).eq('organization_id', input.organizationId).maybeSingle();
    if (enriched) {
      const patch = identityPatch({ name: enriched.full_name, linkedinUrl: enriched.linkedin_url, title: enriched.title }, input.identity);
      const values = {
        ...(patch.name ? { full_name: patch.name } : {}),
        ...(patch.linkedinUrl ? { linkedin_url: patch.linkedinUrl } : {}),
        ...(patch.title ? { title: patch.title } : {}),
      };
      if (Object.keys(values).length) {
        let update = client.from('enriched_leads').update(values)
          .eq('id', input.enrichedLeadId).eq('user_id', input.userId).eq('organization_id', input.organizationId);
        update = enriched.full_name == null ? update.is('full_name', null) : update.eq('full_name', enriched.full_name);
        const { error } = await update;
        if (!error) changed.enrichedLead = Object.keys(values);
      }
    }
  }
  return changed;
}
