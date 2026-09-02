"use client";

import React, { useEffect, useState } from 'react';
import { AlertCircle, Building2, Check, Save, Sparkles, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  PROFILE_SUGGESTION_FIELDS,
  applyProfileSuggestion,
  buildProfileUpdate,
  createEmptyProfileForm,
  getDefaultSuggestionSelection,
  mapProfileToForm,
  normalizeCompanyWebsite,
  type CompanyProfileSuggestion,
  type ProfileFormValues,
  type ProfileSuggestionField,
  type ProfileSuggestionSelection,
} from '@/lib/profile/profile-mappings';
import { profileService } from '@/lib/services/profile-service';
import type { GenerateCompanyProfileOutput } from '@/ai/flows/generate-company-profile';

const fieldCopy: Record<ProfileSuggestionField, string> = {
  sector: 'Sector',
  website: 'Sitio web',
  description: 'Descripcion de la empresa',
  services: 'Productos y servicios',
  valueProposition: 'Propuesta de valor',
};

function sameProfile(left: ProfileFormValues | null, right: ProfileFormValues): boolean {
  if (!left) return false;
  return Object.keys(right).every((key) => left[key as keyof ProfileFormValues] === right[key as keyof ProfileFormValues]);
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileFormValues>(createEmptyProfileForm);
  const [savedProfile, setSavedProfile] = useState<ProfileFormValues | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [websiteError, setWebsiteError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState<CompanyProfileSuggestion | null>(null);
  const [suggestionSelection, setSuggestionSelection] = useState<ProfileSuggestionSelection | null>(null);
  const { toast } = useToast();
  const isDirty = !isLoading && savedProfile !== null && !sameProfile(savedProfile, profile);

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
        setLoadError('No pudimos cargar tu perfil guardado. Recarga la pagina antes de editar para evitar perder cambios.');
      } finally {
        setIsLoading(false);
      }
    }
    void loadProfile();
  }, [loadAttempt]);

  useEffect(() => {
    if (!isDirty) return;
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnAboutUnsavedChanges);
    return () => window.removeEventListener('beforeunload', warnAboutUnsavedChanges);
  }, [isDirty]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const field = event.target.id as keyof ProfileFormValues;
    const value = event.target.value;
    setProfile((current) => ({ ...current, [field]: value }));
    if (field === 'website') setWebsiteError('');
  };

  const handleWebsiteBlur = () => {
    if (!profile.website.trim()) {
      setWebsiteError('');
      return;
    }
    const normalized = normalizeCompanyWebsite(profile.website);
    if (!normalized.domain) {
      setWebsiteError('Ingresa un dominio publico valido, por ejemplo empresa.com.');
      return;
    }
    setWebsiteError('');
    setProfile((current) => ({ ...current, website: normalized.website }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedWebsite = normalizeCompanyWebsite(profile.website);
    if (profile.website.trim() && !normalizedWebsite.domain) {
      setWebsiteError('Ingresa un dominio publico valido, por ejemplo empresa.com.');
      return;
    }

    setIsSaving(true);
    try {
      const currentProfile = await profileService.getProfile();
      const normalizedForm = {
        ...profile,
        website: normalizedWebsite.website,
      };
      const updated = await profileService.updateProfile(buildProfileUpdate(normalizedForm, currentProfile));
      const saved = mapProfileToForm(updated);
      setProfile(saved);
      setSavedProfile(saved);
      toast({
        title: 'Perfil guardado',
        description: 'Tu identidad y contexto comercial quedaron actualizados.',
      });
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({
        variant: 'destructive',
        title: 'No pudimos guardar el perfil',
        description: 'Tus cambios siguen en pantalla. Intenta nuevamente en unos segundos.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutofill = async () => {
    if (!profile.companyName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Falta el nombre de la empresa',
        description: 'Escribelo antes de pedir sugerencias.',
      });
      return;
    }

    if (profile.website.trim() && !normalizeCompanyWebsite(profile.website).domain) {
      setWebsiteError('Corrige el sitio web o dejalo vacio antes de usar IA.');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch('/api/ai/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: profile.companyName.trim(),
          website: profile.website.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'AI request failed');

      const output = payload as GenerateCompanyProfileOutput;
      const nextSuggestion: CompanyProfileSuggestion = {
        sector: output.sector || '',
        website: output.website || (output.domain ? `https://${output.domain}` : ''),
        description: output.description || '',
        services: output.services || '',
        valueProposition: output.valueProposition || '',
      };
      const hasSuggestions = PROFILE_SUGGESTION_FIELDS.some(
        (field) => nextSuggestion[field].trim() && nextSuggestion[field].trim() !== profile[field].trim()
      );
      if (!hasSuggestions) {
        toast({
          title: 'No encontramos datos confiables',
          description: 'Agrega el sitio web oficial o completa el perfil manualmente. No inventamos informacion incierta.',
        });
        return;
      }

      setSuggestion(nextSuggestion);
      setSuggestionSelection(getDefaultSuggestionSelection(profile, nextSuggestion));
    } catch (error) {
      console.error('Error generating company profile:', error);
      toast({
        variant: 'destructive',
        title: 'No pudimos generar sugerencias',
        description: 'Puedes completar los campos manualmente o intentarlo nuevamente.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplySuggestion = () => {
    if (!suggestion || !suggestionSelection) return;
    setProfile((current) => applyProfileSuggestion(current, suggestion, suggestionSelection));
    setSuggestion(null);
    setSuggestionSelection(null);
    toast({
      title: 'Sugerencias aplicadas',
      description: 'Revisa los cambios y guarda el perfil cuando estes listo.',
    });
  };

  const closeSuggestionReview = () => {
    setSuggestion(null);
    setSuggestionSelection(null);
  };

  const selectedSuggestionCount = suggestionSelection
    ? PROFILE_SUGGESTION_FIELDS.filter((field) => suggestionSelection[field]).length
    : 0;

  return (
    <div className="mx-auto max-w-5xl pb-10 pt-2">
      <PageHeader
        title="Perfil"
        description="Define como te presentas y que debe saber la IA sobre tu empresa."
      />

      {loadError ? (
        <Alert className="mb-4 rounded-2xl border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          <AlertTitle>El perfil no esta disponible</AlertTitle>
          <AlertDescription className="text-amber-800 dark:text-amber-100/80">
            <p>{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setLoadAttempt((attempt) => attempt + 1)} className="mt-3 rounded-xl border-amber-300 bg-amber-50 shadow-none hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:hover:bg-amber-500/10">
              Intentar de nuevo
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <form id="profile-form" onSubmit={handleSave}>
        <fieldset disabled={Boolean(loadError) || isSaving} className="min-w-0 border-0 p-0">
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/90 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.45)] dark:bg-card/75">
          <CardHeader className="border-b border-border/60 bg-muted/15 px-5 py-5 sm:px-7">
            <CardTitle className="text-xl tracking-tight">Perfil comercial</CardTitle>
            <CardDescription>Usaremos estos datos para personalizar mensajes y propuestas sin cambiar tu contenido automaticamente.</CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-8 p-5 sm:p-7">
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
            ) : (
              <div className="divide-y divide-border/60">
                <section className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[180px_minmax(0,1fr)]" aria-labelledby="identity-heading">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                      <h2 id="identity-heading">Identidad</h2>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">La firma personal de tus comunicaciones.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nombre</Label>
                      <Input id="name" autoComplete="name" value={profile.name} onChange={handleInputChange} placeholder="Tu nombre completo" className="h-11 rounded-xl bg-background/70" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Cargo</Label>
                      <Input id="role" autoComplete="organization-title" value={profile.role} onChange={handleInputChange} placeholder="Ej. Directora comercial" className="h-11 rounded-xl bg-background/70" />
                    </div>
                  </div>
                </section>

                <section className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[180px_minmax(0,1fr)]" aria-labelledby="company-heading">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <h2 id="company-heading">Empresa</h2>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">Contexto factual para identificar tu negocio.</p>
                  </div>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Completar datos de empresa</p>
                        <p className="text-xs leading-5 text-muted-foreground">La IA propone; tu decides que campos aplicar.</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={handleAutofill} disabled={isGenerating || !profile.companyName.trim()} aria-busy={isGenerating} className="shrink-0 rounded-xl bg-background/80 shadow-none">
                        <Sparkles className="h-4 w-4" />
                        {isGenerating ? 'Buscando datos...' : 'Sugerir con IA'}
                      </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="companyName">Nombre de la empresa</Label>
                        <Input id="companyName" autoComplete="organization" value={profile.companyName} onChange={handleInputChange} placeholder="Ej. Acme" className="h-11 rounded-xl bg-background/70" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="website">Sitio web <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                        <Input
                          id="website"
                          inputMode="url"
                          autoComplete="url"
                          value={profile.website}
                          onChange={handleInputChange}
                          onBlur={handleWebsiteBlur}
                          placeholder="empresa.com"
                          aria-invalid={Boolean(websiteError)}
                          aria-describedby={websiteError ? 'website-error' : undefined}
                          className="h-11 rounded-xl bg-background/70"
                        />
                        {websiteError ? <p id="website-error" className="text-xs text-destructive">{websiteError}</p> : null}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sector">Sector o industria</Label>
                      <Input id="sector" value={profile.sector} onChange={handleInputChange} placeholder="Ej. Software B2B" className="h-11 rounded-xl bg-background/70" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Descripcion de la empresa</Label>
                      <Textarea id="description" value={profile.description} onChange={handleInputChange} placeholder="Que hace la empresa y para quien" className="min-h-24 resize-y rounded-xl bg-background/70" />
                    </div>
                  </div>
                </section>

                <section className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[180px_minmax(0,1fr)]" aria-labelledby="message-heading">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      <h2 id="message-heading">Mensaje comercial</h2>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">La base para redactar mensajes relevantes.</p>
                  </div>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="services">Productos y servicios</Label>
                      <Textarea id="services" value={profile.services} onChange={handleInputChange} placeholder="Describe brevemente lo que ofreces" className="min-h-24 resize-y rounded-xl bg-background/70" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="valueProposition">Propuesta de valor</Label>
                      <Textarea id="valueProposition" value={profile.valueProposition} onChange={handleInputChange} placeholder="Que resultado ayudas a conseguir y por que elegirte" className="min-h-24 resize-y rounded-xl bg-background/70" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="proofPoints">Pruebas y resultados <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                      <Textarea
                        id="proofPoints"
                        rows={4}
                        value={profile.proofPoints}
                        onChange={handleInputChange}
                        placeholder={'Ej. Reducimos un 25% el tiempo de gestión\nEj. Más de 40 equipos implementados'}
                        aria-describedby="proofPoints-help"
                        className="min-h-28 resize-y rounded-xl bg-background/70 leading-6"
                      />
                      <p id="proofPoints-help" className="text-xs leading-5 text-muted-foreground">Agrega un caso, resultado o dato verificable por línea. La IA podrá usarlos como respaldo al redactar.</p>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </CardContent>
          </Card>
        </fieldset>
      </form>

      {isDirty ? (
        <div className="sticky bottom-3 z-20 mt-4 flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/90 p-3 shadow-[0_18px_45px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
            Cambios sin guardar
          </div>
          <Button type="submit" form="profile-form" disabled={isSaving || Boolean(websiteError)} aria-busy={isSaving} className="w-full rounded-xl sm:w-auto">
            {isSaving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      ) : null}

      <Dialog open={Boolean(suggestion)} onOpenChange={(open) => { if (!open) closeSuggestionReview(); }}>
        <DialogContent className="max-h-[88vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-3xl border-border/70 p-0">
          <DialogHeader className="border-b border-border/60 px-5 py-5 pr-12 text-left sm:px-6">
            <DialogTitle>Revisar sugerencias</DialogTitle>
            <DialogDescription>Selecciona que informacion quieres llevar al formulario. Los campos con contenido no se reemplazan por defecto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-5 py-1 sm:px-6">
            {suggestion && suggestionSelection ? PROFILE_SUGGESTION_FIELDS.map((field) => {
              const value = suggestion[field].trim();
              if (!value) return null;
              const hasCurrentValue = Boolean(profile[field].trim());
              return (
                <label key={field} htmlFor={`suggestion-${field}`} className="flex cursor-pointer gap-3 rounded-2xl border border-border/60 p-4 transition-colors hover:bg-muted/35">
                  <Checkbox
                    id={`suggestion-${field}`}
                    checked={suggestionSelection[field]}
                    onCheckedChange={(checked) => setSuggestionSelection((current) => current ? { ...current, [field]: checked === true } : current)}
                    aria-label={`Aplicar ${fieldCopy[field]}`}
                    className="mt-0.5 rounded-md"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {fieldCopy[field]}
                      {hasCurrentValue ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">Reemplaza contenido</span> : <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-700 dark:text-emerald-300"><Check className="h-3 w-3" /> Campo vacio</span>}
                    </span>
                    <span className="mt-1 block whitespace-pre-wrap text-sm leading-5 text-muted-foreground">{value}</span>
                    {hasCurrentValue ? <span className="mt-2 block text-xs leading-5 text-muted-foreground"><strong className="font-medium text-foreground">Actual:</strong> {profile[field]}</span> : null}
                  </span>
                </label>
              );
            }) : null}
          </div>
          <DialogFooter className="border-t border-border/60 bg-muted/15 px-5 py-4 sm:px-6">
            <Button type="button" variant="ghost" onClick={closeSuggestionReview} className="rounded-xl">Cancelar</Button>
            <Button type="button" onClick={handleApplySuggestion} disabled={selectedSuggestionCount === 0} className="rounded-xl">
              Aplicar {selectedSuggestionCount || ''} {selectedSuggestionCount === 1 ? 'campo' : 'campos'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
