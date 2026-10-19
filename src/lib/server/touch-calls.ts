import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructured } from '@/ai/openai-json';
import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import { RECORDING_EXTENSIONS, RECORDING_MAX_BYTES, RECORDING_TYPES, TRANSCRIPT_MAX_CHARS, callCrmNote, callSummaryPrompt, callSummarySchema, type CallSummary } from '@/lib/touches';
import { TouchError, readTouch, readTouchContacts, readTouchProfile, touchModel, touchSeller, type TouchScope } from './touches';

/**
 * Propuesta 19: a call's recording becomes a summary for the CRM. The audio is transcribed (OpenAI) and summarized
 * (the touches' model); only the text stays, with the call's task, and the CRM gets the note, the next step and, when
 * they agreed to meet, a stage suggestion the person confirms. The audio itself is never stored.
 */
type Fetch = typeof fetch;

export function transcribeModel(env: Record<string, string | undefined> = process.env) {
  return env.CALL_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
}

/** Whether a file can be a call recording: an audio type or extension, under the transcription limit. */
export function checkRecording(file: { name: string; type: string; size: number }) {
  if (!file.size) throw new TouchError('El archivo está vacío.', 400);
  if (file.size > RECORDING_MAX_BYTES) throw new TouchError('La grabación supera 25 MB. Grábala en calidad de nota de voz (m4a) o súbela en partes.', 413);
  if (!RECORDING_TYPES.includes(file.type) && !RECORDING_EXTENSIONS.test(file.name)) throw new TouchError('Sube un audio: mp3, m4a, wav, webm u ogg.', 415);
}

/** The words of the call, in Spanish, from OpenAI's transcription. */
export async function transcribeRecording(file: { bytes: ArrayBuffer; name: string; type: string }, deps: { fetch?: Fetch; env?: Record<string, string | undefined> } = {}) {
  const env = deps.env ?? process.env;
  if (!env.OPENAI_API_KEY) throw new TouchError('La transcripción no está conectada.', 503);
  const form = new FormData();
  form.append('file', new Blob([file.bytes], { type: file.type || 'audio/mpeg' }), file.name || 'llamada.m4a');
  form.append('model', transcribeModel(env));
  form.append('language', 'es');
  form.append('response_format', 'json');
  const response = await (deps.fetch ?? fetch)('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(240_000),
  }).catch(() => null);
  if (!response?.ok) throw new TouchError('No pudimos transcribir la grabación. Revisa que se escuche y vuelve a intentarlo.', 502);
  const body = await response.json().catch(() => null) as { text?: string } | null;
  const text = String(body?.text || '').replace(/\s+/g, ' ').trim();
  if (text.length < 20) throw new TouchError('La grabación casi no tiene voz: no hay qué resumir.', 422);
  return text.slice(0, TRANSCRIPT_MAX_CHARS);
}

/** The CRM note before the call, so the call's note goes on top of what the seller wrote instead of replacing it. */
async function crmNotesBefore(client: SupabaseClient, organizationId: string, leadId: string) {
  const result: any = await client.from('unified_crm_data').select('id,notes').eq('organization_id', organizationId)
    .in('id', [`lead_saved|${leadId}`, `lead_enriched|${leadId}`]);
  return String((result.data || []).map((row: any) => row.notes).find((notes: unknown) => typeof notes === 'string' && notes.trim()) || '').trim();
}

/**
 * The call's summary on its task, the task done as «Hablamos», and the CRM updated: the note on top of the earlier
 * ones, the next step with its date and, if they agreed to meet, the suggestion of moving the deal to «Reunión».
 */
export async function attachCallRecording(client: SupabaseClient, scope: TouchScope, id: string,
  file: { bytes: ArrayBuffer; name: string; type: string; durationSeconds?: number | null; note?: string | null },
  deps: { fetch?: Fetch; env?: Record<string, string | undefined>; generate?: typeof generateStructured; now?: Date } = {}) {
  checkRecording({ name: file.name, type: file.type, size: file.bytes.byteLength });
  const touch = await readTouch(client, scope, id);
  if (touch.channel !== 'call') throw new TouchError('La grabación va en una llamada.', 400);
  const [contact] = await readTouchContacts(client, scope, { ids: [touch.contacted_id] });
  if (!contact) throw new TouchError('Ese contacto ya no está en tus conversaciones.', 404);
  const transcript = await transcribeRecording(file, deps);
  const { profile } = await readTouchProfile(client, scope);
  const seller = touchSeller(profile);
  const now = deps.now ?? new Date();
  const today = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).format(now);
  let answer;
  try {
    answer = await (deps.generate ?? generateStructured)({ schema: callSummarySchema, systemPrompt: 'Resumes llamadas comerciales con precisión. Responde JSON conforme al contrato.',
      prompt: callSummaryPrompt({ transcript, seller, contact: { name: String(contact.name || contact.email || ''), role: contact.role, company: contact.company }, today }),
      openAiModel: touchModel(deps.env), allowDefaultModelFallback: false, reasoningEffort: 'low', maxAttempts: 2, timeoutMs: 90_000, maxOutputTokens: 1500 });
  } catch {
    throw new TouchError('Transcribimos la llamada, pero la IA no pudo resumirla. Intenta de nuevo.', 503);
  }
  const summary: CallSummary = { ...answer, transcript, durationSeconds: file.durationSeconds && file.durationSeconds > 0 ? Math.round(file.durationSeconds) : null, createdAt: now.toISOString() };
  const note = file.note?.trim().slice(0, 2000) || null;
  const saved: any = await client.from('contact_touches').update({ call_summary: summary, updated_at: now.toISOString(),
    ...(touch.state === 'open' ? { state: 'done', outcome: 'talked', done_at: now.toISOString(), ...(note ? { note } : {}) } : {}) })
    .eq('id', id).eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  if (saved.error) throw new TouchError('No pudimos guardar el resumen.', 503);
  let crm = false;
  if (contact.lead_id) {
    const next = summary.nextSteps[0];
    const due = next?.due && /^\d{4}-\d{2}-\d{2}$/.test(next.due) ? `${next.due}T12:00:00.000Z` : new Date(now.getTime() + 2 * 86_400_000).toISOString();
    const before = await crmNotesBefore(client, scope.organizationId, contact.lead_id).catch(() => '');
    crm = await syncLeadAutopilotToCrm(client, {
      organizationId: scope.organizationId, leadId: contact.lead_id,
      notes: [callCrmNote(summary, summary.createdAt, note), before].filter(Boolean).join('\n\n').slice(0, 4000),
      nextAction: next?.text.trim().replace(/[\s.;]+$/, '') || (summary.interest === 'bajo' ? 'Cerrar o retomar más adelante' : 'Enviar el resumen de la llamada'),
      nextActionType: 'call_follow_up', nextActionDueAt: due,
      lastAutopilotEvent: summary.meetingAgreed ? 'call_meeting' : 'call_summary',
      // Events never move the stage by themselves: they leave a suggestion the person confirms in the pipeline.
      ...(summary.meetingAgreed ? { stage: 'meeting' } : summary.interest === 'alto' ? { stage: 'engaged' } : {}),
    }).then(() => true, () => false);
  }
  return { summary, crm };
}
