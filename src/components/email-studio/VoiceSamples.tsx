'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Loader2, Mail, MessageSquareQuote, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { OWN_VOICE_SAMPLES_MAX, OWN_VOICE_WORDS, ownVoiceSampleProblem } from '@/lib/voice-own-samples';

type Sample = { id: string; source: 'mailbox' | 'manual'; provider: 'gmail' | 'outlook' | null; subject: string | null; body: string; sentAt: string | null };
type Candidate = { id: string; subject: string; sentAt: string; body: string; words: number };
type Mailbox = 'gmail' | 'outlook';

const MAILBOX_NAME: Record<Mailbox, string> = { gmail: 'Gmail', outlook: 'Outlook' };
const day = (value: string | null) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }).format(time) : '';
};
const SCAN_PROBLEM: Record<string, string> = {
  not_connected: 'Aún no conectas tu correo.',
  reconnect: 'No pudimos leer tus correos enviados. Vuelve a conectar tu correo en Conexiones e inténtalo de nuevo.',
  nothing_found: 'No encontramos correos tuyos que sirvan de ejemplo en los últimos 90 días. Puedes pegar uno a mano.',
};

/**
 * «Tu voz» in «Firmas y estilo»: the emails the app learns the person's way of writing from. They ask for the search in what they sent,
 * see the candidates and keep the ones they choose (five at most), or paste one. Nothing is read or kept without that, and only they
 * see them. The drafts, the follow-ups and the morning contact are then written from these instead of the built-in samples.
 */
export function VoiceSamples() {
  const { toast } = useToast();
  const pasteId = useId();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [connected, setConnected] = useState<Mailbox[]>([]);
  const [scanning, setScanning] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [provider, setProvider] = useState<Mailbox | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState('');

  async function load() {
    setLoadError(false);
    try {
      const response = await fetch('/api/email-studio/voice-samples', { cache: 'no-store' });
      if (!response.ok) throw new Error('load');
      const data = await response.json() as { samples: Sample[]; connected: Mailbox[] };
      setSamples(data.samples || []); setConnected(data.connected || []);
    } catch { setLoadError(true); } finally { setLoaded(true); }
  }
  useEffect(() => { void load(); }, []);

  const room = OWN_VOICE_SAMPLES_MAX - samples.length;

  async function scan() {
    setScanning(true); setNotice(''); setCandidates(null);
    try {
      const response = await fetch('/api/email-studio/voice-samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scan' }) });
      if (!response.ok) throw new Error('scan');
      const data = await response.json() as { provider: Mailbox | null; candidates: Candidate[]; reason?: string };
      const known = new Set(samples.map(sample => sample.body));
      const fresh = (data.candidates || []).filter(candidate => !known.has(candidate.body));
      if (!fresh.length) { setNotice(SCAN_PROBLEM[data.reason || 'nothing_found'] || SCAN_PROBLEM.nothing_found); return; }
      setProvider(data.provider); setCandidates(fresh);
      // The three that show a voice best start chosen: one confirmation is enough.
      setChosen(new Set(fresh.slice(0, Math.min(3, room)).map(candidate => candidate.id)));
    } catch { setNotice('No pudimos buscar en tus correos ahora. Inténtalo de nuevo en un minuto.'); } finally { setScanning(false); }
  }

  async function save(items: Array<Record<string, unknown>>, done: string) {
    setSaving(true);
    try {
      const response = await fetch('/api/email-studio/voice-samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', samples: items }) });
      const data = await response.json().catch(() => null) as { samples?: Sample[]; error?: string } | null;
      if (!response.ok || !data?.samples) { toast({ title: 'No se guardó', description: data?.error || 'Inténtalo de nuevo en un minuto.', variant: 'destructive' }); return false; }
      setSamples(data.samples);
      toast({ title: done, description: 'Tus próximos borradores se escriben con tu forma de escribir.' });
      return true;
    } catch { toast({ title: 'No se guardó', description: 'Revisa tu conexión e inténtalo de nuevo.', variant: 'destructive' }); return false; } finally { setSaving(false); }
  }

  async function saveChosen() {
    const items = (candidates || []).filter(candidate => chosen.has(candidate.id))
      .map(candidate => ({ source: 'mailbox', provider, subject: candidate.subject, body: candidate.body, sentAt: candidate.sentAt }));
    if (await save(items, items.length === 1 ? 'Ejemplo guardado' : `${items.length} ejemplos guardados`)) { setCandidates(null); setChosen(new Set()); }
  }

  async function savePasted() {
    const problem = ownVoiceSampleProblem(pasted.trim());
    if (problem) { setPasteError(problem); return; }
    if (await save([{ source: 'manual', body: pasted.trim() }], 'Ejemplo guardado')) { setPasted(''); setPasting(false); setPasteError(''); }
  }

  async function remove(id: string) {
    setRemoving(id);
    try {
      const response = await fetch(`/api/email-studio/voice-samples?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => null) as { samples?: Sample[] } | null;
      if (!response.ok || !data?.samples) throw new Error('delete');
      setSamples(data.samples);
      toast({ title: 'Ejemplo quitado' });
    } catch { toast({ title: 'No se pudo quitar', description: 'Inténtalo de nuevo en un minuto.', variant: 'destructive' }); } finally { setRemoving(null); }
  }

  function toggle(id: string, on: boolean) {
    setChosen(current => {
      const next = new Set(current);
      if (on) { if (next.size < room) next.add(id); } else next.delete(id);
      return next;
    });
  }

  if (!loaded) {
    return (
      <div role="status" aria-label="Cargando tus ejemplos" className="grid max-w-3xl gap-3">
        <Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  const mailbox = connected[0];
  const searchButton = mailbox ? (
    <Button onClick={() => void scan()} disabled={scanning || room <= 0}>
      {scanning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
      {scanning ? 'Buscando…' : `Buscar en mis enviados de ${MAILBOX_NAME[mailbox]}`}
    </Button>
  ) : (
    <Button asChild><Link href="/connections"><Mail className="h-4 w-4" aria-hidden="true" />Conectar mi correo</Link></Button>
  );
  const pasteButton = (
    <Button variant="outline" onClick={() => { setPasting(true); setPasteError(''); }} disabled={room <= 0}>
      <Plus className="h-4 w-4" aria-hidden="true" />Pegar un correo
    </Button>
  );

  return (
    <div className="grid max-w-3xl gap-6">
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><MessageSquareQuote className="h-5 w-5 text-primary" aria-hidden="true" />Tu voz</CardTitle>
          <CardDescription>
            Elige correos que escribiste tú. ANTON.IA toma de ellos cómo saludas, el largo de tus frases y cómo cierras, y escribe tus borradores, seguimientos y el Contacto del día con esa forma. Lo que dicen esos correos nunca pasa a otro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loadError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <span className="min-w-0 flex-1">No pudimos cargar tus ejemplos.</span>
              <Button variant="outline" size="sm" onClick={() => { setLoaded(false); void load(); }}>Reintentar</Button>
            </div>
          ) : samples.length === 0 && !candidates && !pasting ? (
            <EmptyState icon={MessageSquareQuote} headingLevel="h3" title="Aún no hay ejemplos tuyos"
              description={mailbox
                ? 'Buscamos en tus correos enviados de los últimos 90 días los que escribiste tú a personas de otras empresas. Tú eliges cuáles guardar.'
                : 'Conecta tu correo para buscar ejemplos entre lo que has enviado, o pega uno a mano.'}
              action={<>{searchButton}{pasteButton}</>} />
          ) : (
            <>
              {samples.length > 0 ? (
                <ul className="space-y-3" aria-label="Tus ejemplos guardados">
                  {samples.map(sample => (
                    <li key={sample.id} className="rounded-xl border border-border/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{sample.subject || 'Correo pegado a mano'}</p>
                          <p className="text-xs text-muted-foreground">
                            {[sample.source === 'mailbox' && sample.provider ? `De tus enviados de ${MAILBOX_NAME[sample.provider]}` : 'Pegado por ti', day(sample.sentAt)].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => void remove(sample.id)}
                          disabled={removing === sample.id} aria-label={`Quitar el ejemplo «${sample.subject || 'correo pegado'}»`}>
                          {removing === sample.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}Quitar
                        </Button>
                      </div>
                      <p className="mt-3 line-clamp-4 whitespace-pre-line text-sm leading-6 text-muted-foreground">{sample.body}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!candidates && !pasting ? (
                <div className="flex flex-wrap items-center gap-2">
                  {room > 0 ? <>{searchButton}{pasteButton}</> : null}
                  <span className="text-xs text-muted-foreground">{room > 0 ? `${samples.length} de ${OWN_VOICE_SAMPLES_MAX} ejemplos` : `Tienes los ${OWN_VOICE_SAMPLES_MAX} ejemplos. Quita uno para cambiarlo.`}</span>
                </div>
              ) : null}
            </>
          )}

          {notice ? <p role="status" className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">{notice}</p> : null}

          {candidates ? (
            <section aria-label="Correos encontrados" className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Encontramos {candidates.length === 1 ? '1 correo tuyo' : `${candidates.length} correos tuyos`}</h3>
                <p className="text-xs text-muted-foreground">Marca los que suenan a ti. Puedes guardar {room === 1 ? '1 más' : `hasta ${room}`}; los demás no se guardan en ninguna parte.</p>
              </div>
              <ul className="space-y-2">
                {candidates.map(candidate => {
                  const checked = chosen.has(candidate.id);
                  const full = !checked && chosen.size >= room;
                  return (
                    <li key={candidate.id}>
                      <label htmlFor={`voice-${candidate.id}`} className={`flex items-start gap-3 rounded-xl border border-border/70 p-3 transition-colors ${full ? 'opacity-60' : 'cursor-pointer hover:bg-muted/40'} has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5`}>
                        <Checkbox id={`voice-${candidate.id}`} checked={checked} disabled={full} onCheckedChange={value => toggle(candidate.id, value === true)} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{candidate.subject || 'Sin asunto'}</span>
                          <span className="block text-xs text-muted-foreground">{[day(candidate.sentAt), `${candidate.words} palabras`].filter(Boolean).join(' · ')}</span>
                          <span className="mt-2 block whitespace-pre-line text-sm leading-6 text-muted-foreground line-clamp-6">{candidate.body}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void saveChosen()} disabled={saving || chosen.size === 0}>
                  {saving ? 'Guardando…' : chosen.size <= 1 ? 'Guardar ejemplo' : `Guardar ${chosen.size} ejemplos`}
                </Button>
                <Button variant="ghost" onClick={() => { setCandidates(null); setChosen(new Set()); }} disabled={saving}>Cancelar</Button>
              </div>
            </section>
          ) : null}

          {pasting ? (
            <section aria-label="Pegar un correo" className="space-y-2">
              <Label htmlFor={pasteId}>Un correo que escribiste tú</Label>
              <Textarea id={pasteId} rows={8} value={pasted} onChange={event => { setPasted(event.target.value); setPasteError(''); }}
                placeholder="Pega aquí el correo, desde el saludo hasta la despedida, sin el hilo ni la firma." aria-invalid={Boolean(pasteError)} aria-describedby={`${pasteId}-hint`} />
              <p id={`${pasteId}-hint`} className={`text-xs ${pasteError ? 'text-destructive' : 'text-muted-foreground'}`} role={pasteError ? 'alert' : undefined}>
                {pasteError || `Entre ${OWN_VOICE_WORDS.min} y ${OWN_VOICE_WORDS.max} palabras. Sirve mejor uno que le escribiste a un cliente o a un prospecto.`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void savePasted()} disabled={saving || !pasted.trim()}>{saving ? 'Guardando…' : 'Guardar ejemplo'}</Button>
                <Button variant="ghost" onClick={() => { setPasting(false); setPasted(''); setPasteError(''); }} disabled={saving}>Cancelar</Button>
              </div>
            </section>
          ) : null}

          <p className="flex items-start gap-2 rounded-xl bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>La búsqueda corre solo cuando la pides. Se guardan únicamente los ejemplos que confirmas, hasta {OWN_VOICE_SAMPLES_MAX}; solo tú los ves, ni tu equipo ni tu administrador, y puedes quitarlos cuando quieras. Se usan para escribir tus correos y para nada más.</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
