"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Building2, PenLine, Save, Sparkles, Target, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  PROFILE_COMPANY_SIZES,
  PROFILE_SUGGESTION_FIELDS,
  applyProfileSuggestion,
  buildProfileUpdate,
  createEmptyProfileForm,
  getDefaultSuggestionSelection,
  mapProfileToForm,
  normalizeCompanyWebsite,
  websiteFromWorkEmail,
  type ProfileFormValues,
  type ProfileSuggestionSelection,
} from '@/lib/profile/profile-mappings';
import { autofillEmptyMessage, suggestionFromAutofill, type AutofillResponse, type AutofillSuggestion } from '@/lib/profile/autofill-suggestion';
import { profileService } from '@/lib/services/profile-service';
import { PasswordChangeForm } from '@/components/profile/password-change-form';
import { ProfileAutofillCard } from '@/components/profile/ProfileAutofillCard';
import { ProfileCompleteness } from '@/components/profile/ProfileCompleteness';
import { IcpResultsPanel } from '@/components/profile/IcpResultsPanel';
import { appendTerm } from '@/lib/icp/view';
import { ProfileSuggestionDialog } from '@/components/profile/ProfileSuggestionDialog';

const FIELD_CLASS = 'rounded-xl bg-background/70';
const TEXTAREA_CLASS = `min-h-24 resize-y ${FIELD_CLASS} leading-6`;

function sameProfile(left: ProfileFormValues | null, right: ProfileFormValues): boolean {
  if (!left) return false;
  return Object.keys(right).every((key) => left[key as keyof ProfileFormValues] === right[key as keyof ProfileFormValues]);
}

function Section({ id, icon: Icon, title, description, children, ...anchor }: {
  id: string;
  icon: typeof UserRound;
  title: string;
  description: string;
  children: React.ReactNode;
  /** The screen guide's anchor (src/lib/onboarding/product-tour.ts). */
  'data-tour'?: string;
}) {
  return (
    <section {...anchor} className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[200px_minmax(0,1fr)]" aria-labelledby={`${id}-heading`}>
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id={`${id}-heading`}>{title}</h2>
        </div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="grid min-w-0 gap-4">{children}</div>
    </section>
  );
}

function Field({ id, label, hint, optional, children }: { id: string; label: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}{optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}</Label>
      {children}
      {hint ? <p id={`${id}-help`} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileFormValues>(createEmptyProfileForm);
  const [savedProfile, setSavedProfile] = useState<ProfileFormValues | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [websiteError, setWebsiteError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [aiWebsite, setAiWebsite] = useState('');
  const [aiWebsiteTouched, setAiWebsiteTouched] = useState(false);
  const [aiError, setAiError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState<AutofillSuggestion | null>(null);
  const [suggestionSelection, setSuggestionSelection] = useState<ProfileSuggestionSelection | null>(null);
  const { toast } = useToast();
  const isDirty = !isLoading && savedProfile !== null && !sameProfile(savedProfile, profile);
  const emailWebsite = useMemo(() => websiteFromWorkEmail(user?.email), [user?.email]);

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      setLoadError('');
      try {
        const data = await profileService.getProfile();
        const form = mapProfileToForm(data);
        setProfile(form);
        setSavedProfile(form);
      } catch (error) {
        console.error('Error loading profile:', error);
        setLoadError('No pudimos cargar tu perfil guardado. Recarga la página antes de editar para evitar perder cambios.');
      } finally {
        setIsLoading(false);
      }
    }
    void loadProfile();
  }, [loadAttempt]);

  // The AI card starts from the saved website or, without one, from the work email's domain.
  useEffect(() => {
    if (aiWebsiteTouched || isLoading) return;
    setAiWebsite(normalizeCompanyWebsite(profile.website).domain || emailWebsite);
  }, [aiWebsiteTouched, emailWebsite, isLoading, profile.website]);

  useEffect(() => {
    if (!isDirty) return;
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnAboutUnsavedChanges);
    return () => window.removeEventListener('beforeunload', warnAboutUnsavedChanges);
  }, [isDirty]);

  const setField = (field: keyof ProfileFormValues, value: string) => {
    setProfile((current) => ({ ...current, [field]: value }));
    if (field === 'website') setWebsiteError('');
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setField(event.target.id as keyof ProfileFormValues, event.target.value);
  };

  const handleWebsiteBlur = () => {
    if (!profile.website.trim()) {
      setWebsiteError('');
      return;
    }
    const normalized = normalizeCompanyWebsite(profile.website);
    if (!normalized.domain) {
      setWebsiteError('Ingresa un dominio público válido, por ejemplo empresa.com.');
      return;
    }
    setWebsiteError('');
    setProfile((current) => ({ ...current, website: normalized.website }));
  };

  const focusField = (field: keyof ProfileFormValues) => {
    const element = document.getElementById(field);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => element?.focus({ preventScroll: true }), 250);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedWebsite = normalizeCompanyWebsite(profile.website);
    if (profile.website.trim() && !normalizedWebsite.domain) {
      setWebsiteError('Ingresa un dominio público válido, por ejemplo empresa.com.');
      return;
    }

    setIsSaving(true);
    try {
      const currentProfile = await profileService.getProfile();
      const normalizedForm = { ...profile, website: normalizedWebsite.website };
      const updated = await profileService.updateProfile(buildProfileUpdate(normalizedForm, currentProfile));
      const saved = mapProfileToForm(updated);
      setProfile(saved);
      setSavedProfile(saved);
      toast({ title: 'Perfil guardado', description: 'Desde ahora, la IA usa estos datos para buscar, investigar y escribir.' });
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({ variant: 'destructive', title: 'No pudimos guardar el perfil', description: 'Tus cambios siguen en pantalla. Intenta nuevamente en unos segundos.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutofill = async () => {
    const website = aiWebsite.trim();
    if (website && !normalizeCompanyWebsite(website).domain) {
      setAiError('Ese sitio no parece una dirección pública. Escríbelo como empresa.com.');
      return;
    }
    setAiError('');
    setIsGenerating(true);
    try {
      const response = await fetch('/api/ai/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: profile.companyName.trim() || undefined, website: website || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'No pudimos leer tu empresa ahora. Inténtalo de nuevo en un minuto.');

      const output = payload as AutofillResponse;
      const next = suggestionFromAutofill(output);
      const hasSuggestions = PROFILE_SUGGESTION_FIELDS.some((field) => {
        const value = String(next.values[field] || '').trim();
        return value && value !== String(profile[field] || '').trim();
      });
      if (output.emptyReason || !hasSuggestions) {
        const message = output.emptyReason
          ? autofillEmptyMessage(output)
          : { title: 'Tu perfil ya dice lo mismo', description: 'No encontramos nada distinto de lo que ya escribiste.' };
        setAiError(`${message.title}. ${message.description}`);
        return;
      }
      setSuggestion(next);
      setSuggestionSelection(getDefaultSuggestionSelection(profile, next.values));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'No pudimos leer tu empresa ahora. Inténtalo de nuevo en un minuto.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplySuggestion = () => {
    if (!suggestion || !suggestionSelection) return;
    const count = Object.values(suggestionSelection).filter(Boolean).length;
    setProfile((current) => applyProfileSuggestion(current, suggestion.values, suggestionSelection));
    setSuggestion(null);
    setSuggestionSelection(null);
    toast({ title: `${count} ${count === 1 ? 'campo listo' : 'campos listos'} para revisar`, description: 'Ajusta lo que quieras y presiona «Guardar cambios».' });
  };

  const closeSuggestionReview = () => {
    setSuggestion(null);
    setSuggestionSelection(null);
  };

  return (
    <div className="mx-auto max-w-5xl pb-10 pt-2">
      <PageHeader
        title="Perfil"
        description="Lo que la IA sabe de ti y de tu empresa para buscar prospectos, investigarlos y escribirles."
      />

      {loadError ? (
        <Alert className="mb-4 rounded-2xl border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          <AlertTitle>El perfil no está disponible</AlertTitle>
          <AlertDescription className="text-amber-800 dark:text-amber-100/80">
            <p>{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setLoadAttempt((attempt) => attempt + 1)} className="mt-3 rounded-xl border-amber-300 bg-amber-50 shadow-none hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:hover:bg-amber-500/10">
              Intentar de nuevo
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!loadError ? (
        <ProfileAutofillCard
          website={aiWebsite}
          websiteFromEmail={!aiWebsiteTouched && !profile.website.trim() && Boolean(emailWebsite) && aiWebsite === emailWebsite}
          companyName={profile.companyName}
          running={isGenerating}
          error={aiError}
          onWebsiteChange={(value) => { setAiWebsiteTouched(true); setAiWebsite(value); setAiError(''); }}
          onRun={() => void handleAutofill()}
        />
      ) : null}

      {!isLoading && !loadError ? <ProfileCompleteness profile={profile} onComplete={focusField} /> : null}

      <form id="profile-form" onSubmit={handleSave}>
        <fieldset disabled={Boolean(loadError) || isSaving} className="min-w-0 border-0 p-0">
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/90 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.45)] dark:bg-card/75">
            <CardHeader className="border-b border-border/60 bg-muted/15 px-5 py-5 sm:px-7">
              <CardTitle className="text-xl tracking-tight">Perfil comercial</CardTitle>
              <CardDescription>
                La IA usa estos datos en cada búsqueda, investigación y borrador, y nunca los cambia sin que lo apruebes. El tono, la firma y la llamada a la acción se ajustan en{' '}
                <Link href="/settings/email-studio" className="font-medium text-foreground underline underline-offset-2">Firmas y estilo</Link>.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-8 p-5 sm:p-7" aria-busy="true" aria-label="Cargando tu perfil">
                  {[0, 1, 2, 3].map((section) => (
                    <div className="space-y-4" key={section}>
                      <Skeleton className="h-5 w-36 rounded-lg" />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Skeleton className="h-11 w-full rounded-xl" />
                        <Skeleton className="h-11 w-full rounded-xl" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  <Section id="identity" icon={UserRound} title="Tú" description="Quién firma tus correos y mensajes.">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field id="name" label="Nombre">
                        <Input id="name" autoComplete="name" value={profile.name} onChange={handleInputChange} placeholder="Tu nombre completo" className={`h-11 ${FIELD_CLASS}`} />
                      </Field>
                      <Field id="role" label="Cargo">
                        <Input id="role" autoComplete="organization-title" value={profile.role} onChange={handleInputChange} placeholder="Ej. Ejecutiva comercial" className={`h-11 ${FIELD_CLASS}`} />
                      </Field>
                    </div>
                  </Section>

                  <Section id="company" icon={Building2} title="Tu empresa" description="A quién representas cuando escribes." data-tour="profile-company">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field id="companyName" label="Nombre de la empresa">
                        <Input id="companyName" autoComplete="organization" value={profile.companyName} onChange={handleInputChange} placeholder="Ej. Acme" className={`h-11 ${FIELD_CLASS}`} />
                      </Field>
                      <div className="space-y-2">
                        <Label htmlFor="website">Sitio web</Label>
                        <Input id="website" inputMode="url" autoComplete="url" value={profile.website} onChange={handleInputChange} onBlur={handleWebsiteBlur}
                          placeholder="empresa.com" aria-invalid={Boolean(websiteError)} aria-describedby={websiteError ? 'website-error' : undefined} className={`h-11 ${FIELD_CLASS}`} />
                        {websiteError ? <p id="website-error" className="text-xs text-destructive">{websiteError}</p> : null}
                      </div>
                    </div>
                    <Field id="sector" label="Sector o industria">
                      <Input id="sector" value={profile.sector} onChange={handleInputChange} placeholder="Ej. Outsourcing de recursos humanos" className={`h-11 ${FIELD_CLASS}`} />
                    </Field>
                    <Field id="description" label="Descripción de la empresa" hint="Una o dos oraciones: qué hace y para quién.">
                      <Textarea id="description" value={profile.description} onChange={handleInputChange} aria-describedby="description-help" placeholder="Qué hace la empresa y para quién" className={TEXTAREA_CLASS} />
                    </Field>
                  </Section>

                  <Section id="offer" icon={Sparkles} title="Tu oferta" description="Lo que la IA puede afirmar en tus correos. Solo usa lo que escribas aquí." data-tour="profile-offer">
                    <Field id="services" label="Productos y servicios" hint="Uno por línea, con una frase de qué resuelve. Ej. «Servicios transitorios: personal temporal para peaks de temporada».">
                      <Textarea id="services" value={profile.services} onChange={handleInputChange} aria-describedby="services-help" placeholder={'Ej. Servicio: qué resuelve\nEj. Otro servicio: qué resuelve'} className={`min-h-28 ${TEXTAREA_CLASS}`} />
                    </Field>
                    <Field id="valueProposition" label="Propuesta de valor" hint="El resultado que consigue tu cliente y cómo. Ej. «Ayudamos a centros de distribución a cubrir peaks sin sobrecostos de contratación».">
                      <Textarea id="valueProposition" value={profile.valueProposition} onChange={handleInputChange} aria-describedby="valueProposition-help" placeholder="Qué resultado ayudas a conseguir y por qué elegirte" className={TEXTAREA_CLASS} />
                    </Field>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field id="painPoints" label="Problemas que resuelves" optional hint="Uno por línea, como los diría tu cliente.">
                        <Textarea id="painPoints" value={profile.painPoints} onChange={handleInputChange} aria-describedby="painPoints-help" placeholder={'Ej. Rotación alta en temporada\nEj. Procesos de selección lentos'} className={TEXTAREA_CLASS} />
                      </Field>
                      <Field id="differentiators" label="Por qué elegirte" optional hint="Uno por línea: cobertura, trayectoria, garantías, tecnología.">
                        <Textarea id="differentiators" value={profile.differentiators} onChange={handleInputChange} aria-describedby="differentiators-help" placeholder={'Ej. Cobertura nacional\nEj. Reemplazo garantizado en 48 horas'} className={TEXTAREA_CLASS} />
                      </Field>
                    </div>
                    <Field id="proofPoints" label="Pruebas y resultados" optional hint="Un dato verificable por línea. La IA puede citarlos tal cual.">
                      <Textarea id="proofPoints" rows={4} value={profile.proofPoints} onChange={handleInputChange} aria-describedby="proofPoints-help" placeholder={'Ej. Reducimos un 25 % el tiempo de gestión\nEj. Más de 40 equipos implementados'} className={`min-h-28 ${TEXTAREA_CLASS}`} />
                    </Field>
                    <Field id="referenceClients" label="Clientes que puedes nombrar" optional hint="Separados por coma. Solo los que te autorizan a mencionar.">
                      <Input id="referenceClients" value={profile.referenceClients} onChange={handleInputChange} aria-describedby="referenceClients-help" placeholder="Ej. Empresa A, Empresa B" className={`h-11 ${FIELD_CLASS}`} />
                    </Field>
                  </Section>

                  <Section id="icp" icon={Target} title="Tu cliente ideal" description="A quién le vendes. «Buscar prospectos» parte de aquí." data-tour="profile-icp">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field id="targetRoles" label="Cargos que buscas" hint="Separados por coma, como aparecen en LinkedIn.">
                        <Input id="targetRoles" value={profile.targetRoles} onChange={handleInputChange} aria-describedby="targetRoles-help" placeholder="Ej. Gerente de Personas, Jefe de Operaciones" className={`h-11 ${FIELD_CLASS}`} />
                      </Field>
                      <Field id="targetIndustries" label="Industrias de tus clientes" hint="Separadas por coma.">
                        <Input id="targetIndustries" value={profile.targetIndustries} onChange={handleInputChange} aria-describedby="targetIndustries-help" placeholder="Ej. Retail, logística, minería" className={`h-11 ${FIELD_CLASS}`} />
                      </Field>
                      <div className="space-y-2">
                        <Label htmlFor="targetCompanySize">Tamaño de empresa</Label>
                        <Select value={profile.targetCompanySize || 'any'} onValueChange={(value) => setField('targetCompanySize', value === 'any' ? '' : value)}>
                          <SelectTrigger id="targetCompanySize" className={`h-11 ${FIELD_CLASS}`}><SelectValue placeholder="Cualquier tamaño" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Cualquier tamaño</SelectItem>
                            {PROFILE_COMPANY_SIZES.map((size) => <SelectItem key={size} value={size}>{size.replace('+', ' o más')} personas</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <Field id="targetLocations" label="Países o regiones" hint="Separados por coma.">
                        <Input id="targetLocations" value={profile.targetLocations} onChange={handleInputChange} aria-describedby="targetLocations-help" placeholder="Ej. Chile, Perú" className={`h-11 ${FIELD_CLASS}`} />
                      </Field>
                    </div>
                    <IcpResultsPanel targetIndustries={profile.targetIndustries}
                      onAddIndustry={(industry) => setField('targetIndustries', appendTerm(profile.targetIndustries, industry))} />
                  </Section>
                </div>
              )}
            </CardContent>
          </Card>
        </fieldset>
      </form>

      {isDirty ? (
        <div className="sticky bottom-3 z-20 mt-4 flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/90 p-3 shadow-[0_18px_45px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <PenLine className="h-4 w-4 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            Cambios sin guardar
          </div>
          <Button type="submit" form="profile-form" disabled={isSaving || Boolean(websiteError)} aria-busy={isSaving} className="w-full rounded-xl sm:w-auto">
            {isSaving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      ) : null}

      <PasswordChangeForm />

      <ProfileSuggestionDialog
        suggestion={suggestion}
        selection={suggestionSelection}
        profile={profile}
        onSelectionChange={setSuggestionSelection}
        onApply={handleApplySuggestion}
        onClose={closeSuggestionReview}
      />
    </div>
  );
}
