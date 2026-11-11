import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

/**
 * The emails an organization saved as its own voice («Contexto de redacción», organization_messaging_context.voice_examples). Cowork's
 * Writer already read them; the research drafts did not. A person's own emails say how they write better than any description of it, so
 * the voice pass takes its shape from them instead of the built-in samples (src/lib/outreach-voice.ts).
 * Never blocks a draft: without the table, the row or the examples, the built-in samples are used.
 */
export async function organizationVoiceSamples(organizationId: string, client?: any): Promise<string[]> {
  try {
    const { data, error } = await (client || getSupabaseAdminClient()).from('organization_messaging_context')
      .select('voice_examples').eq('organization_id', organizationId).maybeSingle();
    if (error || !data) return [];
    return voiceSamplesFrom((data as { voice_examples?: unknown }).voice_examples);
  } catch (error) {
    console.warn('[voice-samples] could not read the organization\'s voice examples:', error);
    return [];
  }
}

/** The texts of the stored examples that are long enough to show a voice, three at most. */
export function voiceSamplesFrom(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((item) => String((item && typeof item === 'object' ? (item as { text?: unknown }).text : item) || '').trim())
    .filter((text) => (text.match(/[\p{L}\p{N}]+/gu) || []).length >= 15)
    .map((text) => text.slice(0, 1_500))
    .slice(0, 3);
}
