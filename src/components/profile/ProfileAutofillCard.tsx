'use client';

import { useEffect, useState } from 'react';
import { Globe, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PHASES = ['Leyendo tu sitio…', 'Revisando servicios, clientes y pruebas…', 'Proponiendo cada campo…'];

/**
 * The fastest way to a complete profile: one address, the AI reads the site and proposes every field. The address is
 * prefilled with the saved website or, when there is none, the domain of a work email (ana@grupoexpro.com → grupoexpro.com).
 */
export function ProfileAutofillCard({ website, websiteFromEmail, companyName, loading = false, running, error, onWebsiteChange, onRun }: {
  website: string;
  websiteFromEmail: boolean;
  companyName: string;
  /** The saved profile is still loading: the suggestions are compared with it, so the card waits. */
  loading?: boolean;
  running: boolean;
  error: string;
  onWebsiteChange: (value: string) => void;
  onRun: () => void;
}) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!running) { setPhase(0); return; }
    const timer = window.setInterval(() => setPhase((value) => Math.min(PHASES.length - 1, value + 1)), 7_000);
    return () => window.clearInterval(timer);
  }, [running]);
  const canRun = !loading && Boolean(website.trim() || companyName.trim().length >= 2);

  return (
    <section data-tour="profile-ai" aria-labelledby="profile-ai-title"
      className="mb-4 overflow-hidden rounded-[28px] border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.45)] sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 lg:max-w-md">
          <h2 id="profile-ai-title" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />Complétalo con IA desde tu sitio web
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Leemos las páginas de tu empresa y te proponemos servicios, propuesta de valor, pruebas y cliente ideal, con la página de donde salió cada dato. Tú eliges qué guardar.
          </p>
        </div>
        <form className="flex w-full flex-col gap-2 sm:flex-row sm:items-end lg:max-w-md" onSubmit={(event) => { event.preventDefault(); if (canRun && !running) onRun(); }} aria-busy={loading}>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="ai-website">Sitio web de tu empresa</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="ai-website" inputMode="url" autoComplete="url" value={website} onChange={(event) => onWebsiteChange(event.target.value)}
                placeholder="empresa.com" disabled={running || loading} aria-describedby="ai-website-help" className="h-11 rounded-xl bg-background/80 pl-9" />
            </div>
          </div>
          <Button type="submit" disabled={!canRun || running} aria-busy={running} className="h-11 shrink-0 rounded-xl">
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {running ? 'Leyendo…' : 'Leer mi sitio'}
          </Button>
        </form>
      </div>
      <p id="ai-website-help" className="mt-3 text-xs leading-5 text-muted-foreground" role="status" aria-live="polite">
        {running
          ? `${PHASES[phase]} Puede tardar hasta 30 segundos.`
          : loading
            ? 'Cargando tu perfil…'
            : error
            ? <span className="text-destructive">{error}</span>
            : websiteFromEmail
              ? 'Lo tomamos de tu correo corporativo. Cámbialo si tu empresa usa otro sitio.'
              : '¿Sin sitio web? Deja este campo vacío y buscaremos tu empresa por su nombre.'}
      </p>
    </section>
  );
}
