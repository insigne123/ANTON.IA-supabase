'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronDown, PenLine, Save, Users } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { CompanySections } from '@/components/profile/ProfileSections';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  COMPANY_PROFILE_FIELDS, companyProfileFields, companyProfileHasOffer, companyProfileReview, companyProfileServices, mergeCompanySuggestion,
  type CompanyProfile, type CompanyProfileField, type CompanyProfileFields,
} from '@/lib/profile/company-profile';
import { normalizeCompanyWebsite } from '@/lib/profile/profile-mappings';

type Suggestion = { source: 'person' | 'opportunities'; label: string; fields: Partial<CompanyProfileFields> };
type Loaded = { profile: CompanyProfile | null; canEdit: boolean; suggestions?: Suggestion[] };

const EMPTY = companyProfileFields({});
const same = (left: CompanyProfileFields, right: CompanyProfileFields) => COMPANY_PROFILE_FIELDS.every(field => left[field] === right[field]);
const dateLabel = (at: string) => new Date(at).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' });

/** One line of what a suggestion offers: its products, or the result it promises. */
function preview(fields: Partial<CompanyProfileFields>) {
  const services = companyProfileServices({ services: fields.services ?? '' });
  if (services.length) return services.slice(0, 2).join(' · ') + (services.length > 2 ? ` y ${services.length - 2} más` : '');
  return fields.valueProposition || fields.description || '';
}

/**
 * «Empresa» in Administración (APP-06): the «Ficha de la empresa» that Cowork, drafts, suggested replies, research and
 * Oportunidades write from. It starts from what the team already wrote (each person's «Tu oferta» and the offer confirmed in
 * Oportunidades), saving it is reviewing it, and after 90 days it asks to be looked at again.
 */
export function CompanyProfileEditor() {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [values, setValues] = useState<CompanyProfileFields>(EMPTY);
  const [saved, setSaved] = useState<CompanyProfileFields>(EMPTY);
  const [websiteError, setWebsiteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ status: number; message: string } | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/company-profile?suggestions=1', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'No pudimos leer la ficha de la empresa.');
      const data = payload as Loaded;
      const fields = data.profile ? companyProfileFields(data.profile.fields) : EMPTY;
      setLoaded(data);
      setValues(fields);
      setSaved(fields);
      setSaveError(null);
      // Before there is a profile, what the team wrote is where to start.
      setSuggestionsOpen(!data.profile);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No pudimos leer la ficha de la empresa.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const profile = loaded?.profile ?? null;
  const dirty = Boolean(loaded) && !same(values, saved);
  const review = companyProfileReview(profile?.reviewedAt ?? null);
  const reviewDue = Boolean(profile) && review.due;
  const suggestions = loaded?.suggestions ?? [];

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setField = (field: CompanyProfileField, value: string) => {
    setValues(current => ({ ...current, [field]: value }));
    if (field === 'website') setWebsiteError('');
  };
  const handleWebsiteBlur = () => {
    if (!values.website.trim()) return setWebsiteError('');
    const normalized = normalizeCompanyWebsite(values.website);
    if (!normalized.domain) return setWebsiteError('Ingresa un dominio público válido, por ejemplo empresa.com.');
    setWebsiteError('');
    setValues(current => ({ ...current, website: normalized.website }));
  };

  const applySuggestion = (suggestion: Suggestion) => {
    const { values: next, added } = mergeCompanySuggestion(values, suggestion.fields);
    if (!added) {
      toast({ title: 'La ficha ya dice eso', description: `No hay nada de ${suggestion.label} que falte en la ficha.` });
      return;
    }
    setValues(next);
    toast({ title: `${added} ${added === 1 ? 'campo listo' : 'campos listos'} para revisar`, description: 'Llenamos lo que estaba vacío y sumamos los productos que faltaban. Ajusta y guarda.' });
  };

  const save = async () => {
    const website = normalizeCompanyWebsite(values.website);
    if (values.website.trim() && !website.domain) return setWebsiteError('Ingresa un dominio público válido, por ejemplo empresa.com.');
    const reviewing = !dirty;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch('/api/company-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { ...values, website: website.domain ? website.website : values.website }, revision: profile?.revision ?? 0 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSaveError({ status: response.status, message: payload?.error || 'No pudimos guardar la ficha. Intenta de nuevo en unos segundos.' });
        return;
      }
      await load();
      toast(reviewing
        ? { title: 'Ficha revisada', description: 'Queda con la fecha de hoy. Te pediremos mirarla de nuevo en 90 días.' }
        : { title: 'Ficha guardada', description: 'Desde ahora, todo el equipo escribe desde ella.' });
    } catch {
      setSaveError({ status: 0, message: 'No pudimos guardar la ficha. Tus cambios siguen en pantalla: intenta de nuevo en unos segundos.' });
    } finally {
      setSaving(false);
    }
  };

  const status = !profile
    ? 'Todavía no hay ficha: cada persona escribe desde lo que puso en su Perfil.'
    : `${profile.reviewedAt ? `Revisada por ${profile.reviewedBy || 'un administrador'} el ${dateLabel(profile.reviewedAt)}.` : 'Sin fecha de revisión.'}${reviewDue ? ' Toca revisarla de nuevo.' : ''}`;

  return (
    <div className="mx-auto max-w-5xl pb-10">
      <PageHeader
        title="Ficha de la empresa"
        description="Lo que la empresa es, vende y a quién le vende, dicho una vez para todo el equipo. Cowork, los borradores, la investigación y Oportunidades escriben desde aquí."
      />

      {loadError ? (
        <Alert variant="warning" className="mb-4 rounded-2xl">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>La ficha no está disponible</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="mt-3 rounded-xl">Intentar de nuevo</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loaded && !loaded.canEdit ? (
        <Alert className="mb-4 rounded-2xl">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Solo la editan los dueños y administradores</AlertTitle>
          <AlertDescription>Tu equipo ve la ficha en su Perfil. Pide a un dueño o administrador de tu organización que la cambie.</AlertDescription>
        </Alert>
      ) : null}

      {loaded?.canEdit && suggestions.length ? (
        <Collapsible open={suggestionsOpen} onOpenChange={setSuggestionsOpen} className="mb-4 rounded-[24px] border border-border/60 bg-card/90 dark:bg-card/75">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between gap-3 rounded-[24px] p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6">
              <span className="flex min-w-0 items-start gap-3">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Lo que el equipo ya escribió</span>
                  <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">
                    {suggestions.length === 1 ? '1 oferta' : `${suggestions.length} ofertas`} de Perfil y Oportunidades. «Usar» llena lo vacío y suma los productos que faltan.
                  </span>
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${suggestionsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {suggestions.map((suggestion, index) => (
                <li key={`${suggestion.label}-${index}`} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{suggestion.label}</p>
                    <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{preview(suggestion.fields)}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-xl" disabled={saving}
                    aria-label={`Usar lo que escribió ${suggestion.label}`} onClick={() => applySuggestion(suggestion)}>Usar</Button>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {saveError ? (
        <Alert variant={saveError.status === 409 ? 'warning' : 'destructive'} className="mb-4 rounded-2xl" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{saveError.status === 409 ? 'Alguien cambió la ficha' : 'No se guardó'}</AlertTitle>
          <AlertDescription>
            <p>{saveError.message}</p>
            {saveError.status === 409 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="mt-3 rounded-xl">Ver su versión</Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <form id="company-profile-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={!loaded?.canEdit || saving} className="min-w-0 border-0 p-0">
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/90 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.45)] dark:bg-card/75">
            <CardHeader className="border-b border-border/60 bg-muted/15 px-5 py-5 sm:px-7">
              <CardTitle className="text-xl tracking-tight">Ficha</CardTitle>
              <CardDescription>
                {loaded ? <span className={reviewDue ? 'text-foreground' : undefined}>{status}</span> : 'Cargando…'}{' '}
                Cada persona elige en su Perfil cuáles de estos productos vende; su nombre, su cargo y su tono siguen siendo suyos.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!loaded && !loadError ? (
                <div className="space-y-8 p-5 sm:p-7" aria-busy="true" aria-label="Cargando la ficha de la empresa">
                  {[0, 1, 2].map((section) => (
                    <div className="space-y-4" key={section}>
                      <Skeleton className="h-5 w-36 rounded-lg" />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Skeleton className="h-11 w-full rounded-xl" />
                        <Skeleton className="h-11 w-full rounded-xl" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : loaded ? (
                <div className="divide-y divide-border/60">
                  <CompanySections copy="company" values={values} onChange={setField} onWebsiteBlur={handleWebsiteBlur} websiteError={websiteError} />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </fieldset>
      </form>

      {loaded?.canEdit && (dirty || reviewDue) ? (
        <div className="sticky bottom-3 z-20 mt-4 flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/90 p-3 shadow-[0_18px_45px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <PenLine className="h-4 w-4 text-cw-warning" aria-hidden="true" />
            {dirty
              ? companyProfileHasOffer(values) ? 'Cambios sin guardar' : 'Escribe qué vende la empresa para poder guardar'
              : `Pasaron ${review.daysAgo ?? 'más de 90'} días desde la última revisión`}
          </div>
          <Button type="submit" form="company-profile-form" disabled={saving || Boolean(websiteError) || !companyProfileHasOffer(values)} aria-busy={saving} className="w-full rounded-xl sm:w-auto">
            {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : dirty ? <Save className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Guardando…' : dirty ? 'Guardar ficha' : 'Marcar como revisada'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
