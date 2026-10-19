'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Check, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { profileService } from '@/lib/services/profile-service';
import { bookingProvider, normalizeBookingUrl, readBookingPreference, type BookingMode } from '@/lib/booking-link';

const MODES: Array<{ value: BookingMode; title: string; text: string }> = [
  { value: 'auto', title: 'Automático (recomendado)', text: 'La IA lo agrega a la respuesta sugerida cuando la persona muestra interés o pide una reunión. Nunca va en un primer correo.' },
  { value: 'on_request', title: 'Solo cuando lo pida', text: 'Aparece el botón «Insertar mi agenda» al responder; la IA no lo agrega sola.' },
  { value: 'never', title: 'Nunca', text: 'Ningún correo lleva enlace de agenda.' },
];

/**
 * «Agenda» in «Firmas y estilo» (propuesta 3): the booking link and when it goes in an email, plus when «Para retomar»
 * brings someone back. One save for the link; the reminder saves when chosen.
 */
export function BookingSettings() {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<BookingMode>('auto');
  const [saved, setSaved] = useState<{ url: string; mode: BookingMode }>({ url: '', mode: 'auto' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [afterDays, setAfterDays] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    profileService.getSignatures().then((signatures: any) => {
      if (cancelled) return;
      const preference = readBookingPreference(signatures);
      const next = { url: preference?.url || '', mode: preference?.mode || 'auto' };
      setUrl(next.url); setMode(next.mode); setSaved(next);
      const reconnect = Number(signatures?.reconnect?.afterDays);
      setAfterDays([0, 30, 60, 90].includes(reconnect) ? String(reconnect) : '60');
    }).catch(() => { if (!cancelled) setAfterDays('60'); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const normalized = url.trim() ? normalizeBookingUrl(url) : '';
  const provider = normalized ? bookingProvider(normalized) : null;
  const dirty = (normalized ?? url.trim()) !== saved.url || mode !== saved.mode;
  const needsUrl = mode !== 'never' && !url.trim();

  async function save() {
    if (normalized === null) { setError('Revisa el enlace: debe ser una dirección https, como https://calendly.com/tu-nombre.'); return; }
    if (needsUrl) { setError('Pega el enlace de tu agenda o elige «Nunca».'); return; }
    setSaving(true); setError('');
    try {
      const signatures = await profileService.getSignatures();
      await profileService.setSignatures({ ...signatures, booking: { url: normalized || '', mode, updatedAt: new Date().toISOString() } });
      setSaved({ url: normalized || '', mode });
      setUrl(normalized || '');
      toast({ title: 'Agenda guardada', description: mode === 'never' ? 'Ningún correo llevará enlace de agenda.' : 'La usaremos como elegiste.' });
    } catch {
      setError('No pudimos guardar. Revisa tu conexión e intenta de nuevo.');
    } finally { setSaving(false); }
  }

  async function saveAfter(value: string) {
    const previous = afterDays;
    setAfterDays(value);
    const response = await fetch('/api/reconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'settings', afterDays: Number(value) }) }).catch(() => null);
    if (!response?.ok) { setAfterDays(previous); toast({ title: 'No se pudo guardar el aviso', variant: 'destructive' }); return; }
    toast({ title: value === '0' ? 'No te avisaremos para retomar' : `Te avisaremos a los ${value} días` });
  }

  if (!loaded) {
    return <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Cargando tu agenda…</div>;
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" />Tu agenda</CardTitle>
          <CardDescription>El enlace donde las personas eligen un horario contigo. Sirve Calendly, Google Calendar (agenda de citas), Microsoft Bookings, HubSpot o cualquier página https.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="booking-url">Enlace de tu agenda</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="booking-url" inputMode="url" autoComplete="url" placeholder="https://calendly.com/tu-nombre/30min" value={url}
                onChange={event => { setUrl(event.target.value); setError(''); }} aria-invalid={normalized === null} aria-describedby="booking-url-hint" />
              {normalized ? (
                <Button asChild variant="outline" className="shrink-0">
                  <a href={normalized} target="_blank" rel="noreferrer">Probar<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
                </Button>
              ) : null}
            </div>
            <p id="booking-url-hint" className="text-xs text-muted-foreground">
              {normalized === null ? 'Debe ser una dirección https.' : provider ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{provider}</span> : 'Pega la dirección que compartes para agendar.'}
            </p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">¿Cuándo va en tus correos?</legend>
            <RadioGroup value={mode} onValueChange={value => setMode(value as BookingMode)} className="gap-2">
              {MODES.map(option => (
                <label key={option.value} htmlFor={`booking-mode-${option.value}`}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem id={`booking-mode-${option.value}`} value={option.value} className="mt-0.5" />
                  <span className="min-w-0"><span className="block text-sm font-medium">{option.title}</span><span className="block text-xs text-muted-foreground">{option.text}</span></span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={saving || !dirty}>{saving ? 'Guardando…' : 'Guardar agenda'}</Button>
            {!dirty && saved.url ? <span className="text-xs text-muted-foreground">Guardada</span> : null}
          </div>

          <details className="rounded-xl bg-muted/30 p-4 text-sm">
            <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">¿No tienes una? Créala gratis en Google Calendar</summary>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Abre Google Calendar en el computador y pulsa «Crear» → «Agenda de citas».</li>
              <li>Elige la duración (por ejemplo, 30 minutos) y tus horarios disponibles, y guarda.</li>
              <li>Abre la agenda, pulsa «Compartir» y copia el enlace. Pégalo aquí.</li>
            </ol>
            <a className="mt-3 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" href="https://support.google.com/calendar/answer/10729749?hl=es" target="_blank" rel="noreferrer">
              Guía de Google<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </details>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-lg">Avisos para retomar</CardTitle>
          <CardDescription>En «Hoy» te avisamos cuando vale la pena volver a escribirle a alguien con quien cerraste sin acuerdo o que dejaste en «Lo retomo yo».</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex flex-wrap items-center gap-3 text-sm">
            Avisarme después de
            <Select value={afterDays ?? '60'} onValueChange={value => void saveAfter(value)}>
              <SelectTrigger className="w-[140px]" aria-label="Avisarme después de"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 días</SelectItem>
                <SelectItem value="60">60 días</SelectItem>
                <SelectItem value="90">90 días</SelectItem>
                <SelectItem value="0">Nunca</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </CardContent>
      </Card>
    </div>
  );
}
