"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, PenLine, Save, Sparkles, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileIndex } from '@/components/profile/ProfileIndex';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { useSharedNavAccess } from '@/hooks/use-nav-access';
import { useToast } from '@/hooks/use-toast';
import {
  PROFILE_SUGGESTION_FIELDS,
  applyProfileSuggestion,
  buildProfileUpdate,
  createEmptyProfileForm,
  getDefaultSuggestionSelection,
  icpFilledByAnton,
  mapProfileToForm,
  normalizeCompanyWebsite,
  websiteFromWorkEmail,
  type ProfileFormValues,
  type ProfileSuggestionSelection,
} from '@/lib/profile/profile-mappings';
import { autofillEmptyMessage, suggestionFromAutofill, type AutofillResponse, type AutofillSuggestion } from '@/lib/profile/autofill-suggestion';
import { suggestionFromWorkspaceOffer, type WorkspaceOffer } from '@/lib/profile/workspace-offer-suggestion';
import { profileService } from '@/lib/services/profile-service';
import { PasswordChangeForm } from '@/components/profile/password-change-form';
import { ProfileAutofillCard } from '@/components/profile/ProfileAutofillCard';
import { ProfileCompleteness } from '@/components/profile/ProfileCompleteness';
import { ProfileIcpSummary } from '@/components/profile/ProfileIcpSummary';
import { IcpResultsPanel } from '@/components/profile/IcpResultsPanel';
import { appendTerm } from '@/lib/icp/view';
import { ProfileSuggestionDialog } from '@/components/profile/ProfileSuggestionDialog';
import { CompanySections, Field, FIELD_CLASS, Section } from '@/components/profile/ProfileSections';
import { CompanyProfileReadOnly } from '@/components/profile/CompanyProfileReadOnly';
import { icpSummary } from '@/lib/profile/icp-summary';
import {
  companyProfileHasOffer, companyProfileServices, companyServicesPicked, withCompanyFields, type CompanyProfile,
} from '@/lib/profile/company-profile';
import { companyProfileService } from '@/lib/services/company-profile-service';

function sameProfile(left: ProfileFormValues | null, right: ProfileFormValues): boolean {
  if (!left) return false;
  return Object.keys(right).every((key) => left[key as keyof ProfileFormValues] === right[key as keyof ProfileFormValues]);
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
  const [workspaceOffer, setWorkspaceOffer] = useState<WorkspaceOffer | null>(null);
  const [icpSuggested, setIcpSuggested] = useState(false);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [canEditCompany, setCanEditCompany] = useState(false);
  // Which of the company's products and services the person sells; none reads as all.
  const [picked, setPicked] = useState<string[]>([]);
  const [savedPicked, setSavedPicked] = useState<string[]>([]);
  const { opportunities } = useSharedNavAccess();
  const { toast } = useToast();
  // With a «Ficha de la empresa», the company part is the team's and read only here; the person keeps their name and role.
  const companyActive = Boolean(company && companyProfileHasOffer(company.fields));
  const picksChanged = companyActive && [...picked].sort().join('\n') !== [...savedPicked].sort().join('\n');
  const isDirty = !isLoading && savedProfile !== null && (!sameProfile(savedProfile, profile) || picksChanged);
  // What the AI reads for this person: their profile with the company's fields over it.
  const effective = useMemo(() => (company && companyActive ? withCompanyFields(profile, company.fields, picked) : profile), [company, companyActive, profile, picked]);
  const confirmIcp = icpSuggested && !companyActive;
  const emailWebsite = useMemo(() => websiteFromWorkEmail(user?.email), [user?.email]);

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      setLoadError('');
      try {
        const [data, companyRead] = await Promise.all([profileService.getProfile(), companyProfileService.read()]);
        const form = mapProfileToForm(data);
        setProfile(form);
        setSavedProfile(form);
        setIcpSuggested(icpFilledByAnton(data));
        setCompany(companyRead?.profile ?? null);
        setCanEditCompany(companyRead?.canEdit === true);
        const picks = companyServicesPicked(data);
        setPicked(picks);
        setSavedPicked(picks);
      } catch (error) {
        console.error('Error loading profile:', error);
        setLoadError('No pudimos cargar tu perfil guardado. Recarga la página antes de editar para evitar perder cambios.');
      } finally {
        setIsLoading(false);
      }
    }
    void loadProfile();
  }, [loadAttempt]);

  // The offer an admin confirmed in «Oportunidades» is the team's: whoever sells it can bring it here instead of retyping it.
  useEffect(() => {
    if (!opportunities) return;
    const controller = new AbortController();
    fetch('/api/commercial-opportunities/workspace/offer', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => { if (!controller.signal.aborted && data?.offer) setWorkspaceOffer(data.offer as WorkspaceOffer); })
      .catch(() => {});
    return () => controller.abort();
  }, [opportunities]);
  const workspaceSuggestion = useMemo(() => (workspaceOffer && !isLoading ? suggestionFromWorkspaceOffer(workspaceOffer, profile) : null),
    [workspaceOffer, isLoading, profile]);

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
    if (!companyActive && profile.website.trim() && !normalizedWebsite.domain) {
      setWebsiteError('Ingresa un dominio público válido, por ejemplo empresa.com.');
      return;
    }

    // Nothing edited and the ideal customer is ANTON.IA's: saving as is confirms it.
    const confirming = confirmIcp && !isDirty;
    setIsSaving(true);
    try {
      const currentProfile = await profileService.getProfile();
      const normalizedForm = { ...profile, website: normalizedWebsite.domain ? normalizedWebsite.website : profile.website };
      const update = buildProfileUpdate(normalizedForm, currentProfile);
      // The picks are kept by name: a product the admins renamed or removed drops out, and none left reads as all again.
      const services = company && companyActive ? companyProfileServices(company.fields) : [];
      const companyServices = picked.filter((service) => services.includes(service));
      const updated = await profileService.updateProfile(companyActive
        ? { ...update, signatures: { ...update.signatures, profile_extended: { ...(update.signatures.profile_extended as Record<string, unknown>), companyServices } } }
        : update);
      const saved = mapProfileToForm(updated);
      setProfile(saved);
      setSavedProfile(saved);
      if (companyActive) { setPicked(companyServices); setSavedPicked(companyServices); }
      setIcpSuggested(false);
      toast(confirming
        ? { title: 'Cliente ideal confirmado', description: 'Con él elegimos tu contacto del día.' }
        : { title: 'Perfil guardado', description: 'Desde ahora, la IA usa estos datos para buscar, investigar y escribir.' });
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({ variant: 'destructive', title: 'No pudimos guardar el perfil', description: 'Tus cambios siguen en pantalla. Intenta nuevamente en unos segundos.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutofill = async () => {
    // Suggestions are compared with the saved profile: before it loads, every field would look empty.
    if (isLoading) return;
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

  const handleUseWorkspaceOffer = () => {
    if (!workspaceSuggestion) return;
    setAiError('');
    setSuggestion(workspaceSuggestion);
    setSuggestionSelection(getDefaultSuggestionSelection(profile, workspaceSuggestion.values));
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
        <Alert variant="warning" className="mb-4 rounded-2xl">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>El perfil no está disponible</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setLoadAttempt((attempt) => attempt + 1)} className="mt-3 rounded-xl">
              Intentar de nuevo
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* With a «Ficha de la empresa» there is nothing of the company to fill here: the admins keep it. */}
      {!loadError && !companyActive ? (
        <ProfileAutofillCard
          website={aiWebsite}
          websiteFromEmail={!aiWebsiteTouched && !profile.website.trim() && Boolean(emailWebsite) && aiWebsite === emailWebsite}
          companyName={profile.companyName}
          loading={isLoading}
          running={isGenerating}
          error={aiError}
          onWebsiteChange={(value) => { setAiWebsiteTouched(true); setAiWebsite(value); setAiError(''); }}
          onRun={() => void handleAutofill()}
          onUseWorkspaceOffer={workspaceSuggestion ? handleUseWorkspaceOffer : undefined}
        />
      ) : null}

      {!isLoading && !loadError && !companyActive ? <ProfileCompleteness profile={profile} onComplete={focusField} /> : null}
      {!isLoading && !loadError && (!companyActive || icpSummary(effective).defined)
        ? <ProfileIcpSummary profile={effective} dirty={isDirty} onEdit={companyActive ? undefined : () => focusField('targetRoles')} />
        : null}
      {/* Five parts in some 3.200 px: the index names them and marks the one on screen (APP-07). */}
      {!isLoading && !loadError ? <ProfileIndex /> : null}

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

                  {company && companyActive ? (
                    <CompanyProfileReadOnly profile={company} canEdit={canEditCompany} picked={picked} onPickedChange={setPicked} />
                  ) : (
                    <CompanySections
                      values={profile}
                      onChange={setField}
                      onWebsiteBlur={handleWebsiteBlur}
                      websiteError={websiteError}
                      icpNote={icpSuggested ? <p className="flex items-start gap-2 rounded-xl bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <span>Lo completamos por ti con lo que vende tu empresa y los contactos que guardaste. Revísalo, ajústalo si hace falta y confírmalo abajo: con él elegimos tu contacto del día.</span>
                      </p> : null}
                      icpExtra={<IcpResultsPanel targetIndustries={profile.targetIndustries}
                        onAddIndustry={(industry) => setField('targetIndustries', appendTerm(profile.targetIndustries, industry))} />}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </fieldset>
      </form>

      {isDirty || (confirmIcp && !isLoading && !loadError) ? (
        <div className="sticky bottom-3 z-20 mt-4 flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/90 p-3 shadow-[0_18px_45px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            {isDirty ? <PenLine className="h-4 w-4 text-cw-warning" aria-hidden="true" /> : <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />}
            {isDirty ? 'Cambios sin guardar' : 'Tu cliente ideal espera tu visto bueno'}
          </div>
          <Button type="submit" form="profile-form" disabled={isSaving || Boolean(websiteError)} aria-busy={isSaving} className="w-full rounded-xl sm:w-auto">
            {isSaving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : isDirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {isSaving ? 'Guardando…' : isDirty ? 'Guardar cambios' : 'Confirmar'}
          </Button>
        </div>
      ) : null}

      <div id="security-heading" className="scroll-mt-28"><PasswordChangeForm /></div>

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
