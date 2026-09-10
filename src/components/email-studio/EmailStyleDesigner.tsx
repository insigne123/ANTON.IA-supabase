'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Mail, Plus, RefreshCw, Save, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { generateMailFromStyle } from '@/lib/ai/style-mail';
import { findReportForLead } from '@/lib/lead-research-storage';
import { OUTSOURCING_EMAIL_STYLE_PRESETS } from '@/lib/outsourcing-email-style-presets';
import {
  buildCompanyProfileInfo,
  buildSenderInfo,
} from '@/lib/signature-placeholders';
import { getEnrichedLeads } from '@/lib/services/enriched-leads-service';
import { profileService, type Profile } from '@/lib/services/profile-service';
import { defaultStyle } from '@/lib/style-profiles-storage';
import type { CrossReport, EnrichedLead, StyleProfile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { emailLibraryError, emailStyleDraftKey, type EmailLibraryScope } from '@/lib/email-studio/library-contract';
import type { GRUPOEXPRO_REFERENCE_TEMPLATES } from '@/lib/email-studio/grupoexpro-templates';

type SavedEmailStyle = {
  id: string;
  name: string;
  profile: StyleProfile;
  revision: number;
  isDefault: boolean;
  updatedAt: string;
  libraryScope: EmailLibraryScope;
  sourceCollection?: string | null;
  publishedAt?: string | null;
};

type ResearchLeadOption = {
  lead: EnrichedLead;
  report: CrossReport;
};

type PresetId = (typeof OUTSOURCING_EMAIL_STYLE_PRESETS)[number]['id'];

const DEFAULT_INSTRUCTIONS =
  'Profesional y humano. Usa frases claras, personalización relevante y una invitación breve, sin exageraciones.';

const STYLE_PRESETS = OUTSOURCING_EMAIL_STYLE_PRESETS;

function createStyleDraft(): StyleProfile {
  return {
    ...defaultStyle,
    name: 'Mi estilo de correo',
    instructions: DEFAULT_INSTRUCTIONS,
    structure: [...(defaultStyle.structure || [])],
    do: [...(defaultStyle.do || [])],
    dont: [...(defaultStyle.dont || [])],
    tokens: [...(defaultStyle.tokens || [])],
    personalization: { ...defaultStyle.personalization },
    cta: { ...defaultStyle.cta },
    constraints: { ...defaultStyle.constraints },
  };
}

function normalizeSavedStyle(style: SavedEmailStyle): SavedEmailStyle {
  const name = String(style.name || style.profile?.name || 'Estilo sin nombre').trim();
  const updatedAt = style.updatedAt || style.profile?.updatedAt || new Date().toISOString();
  const draft = createStyleDraft();

  return {
    ...style,
    libraryScope: style.libraryScope || 'personal',
    id: String(style.id),
    name,
    revision: Number(style.revision || 0),
    isDefault: Boolean(style.isDefault),
    updatedAt,
    profile: {
      ...draft,
      ...style.profile,
      cta: { ...draft.cta, ...style.profile?.cta },
      constraints: { ...draft.constraints, ...style.profile?.constraints },
      personalization: { ...draft.personalization, ...style.profile?.personalization },
      id: String(style.id),
      isDefault: Boolean(style.isDefault),
      name,
      updatedAt,
    },
  };
}

function reportForLead(lead: EnrichedLead): CrossReport | null {
  const cached = findReportForLead({
    leadId: lead.id,
    email: lead.email || null,
    companyDomain: lead.companyDomain || null,
    companyName: lead.companyName || null,
  });
  if (cached?.cross) return cached.cross;

  const embedded = lead.report;
  if (!embedded) return null;
  if ('pains' in embedded) return embedded;
  return embedded.cross || null;
}

function toneLabel(tone: StyleProfile['tone']) {
  const labels: Partial<Record<NonNullable<StyleProfile['tone']>, string>> = {
    brief: 'Breve',
    challenger: 'Desafiante',
    commercial: 'Comercial',
    consultative: 'Consultivo',
    direct: 'Directo',
    executive: 'Ejecutivo',
    professional: 'Profesional',
    warm: 'Cercano',
  };
  return tone ? labels[tone] || tone : 'Profesional';
}

export default function EmailStyleDesigner() {
  const { toast } = useToast();
  const styleNameRef = useRef<HTMLInputElement>(null);
  const [styles, setStyles] = useState<SavedEmailStyle[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState('');
  const [selectedRevision, setSelectedRevision] = useState<number | undefined>();
  const [styleName, setStyleName] = useState('Mi estilo de correo');
  const [profile, setProfile] = useState<StyleProfile>(() => createStyleDraft());
  const [isDefault, setIsDefault] = useState(true);
  const [libraryScope, setLibraryScope] = useState<EmailLibraryScope>('personal');
  const [sourceCollection, setSourceCollection] = useState<string | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [references, setReferences] = useState<typeof GRUPOEXPRO_REFERENCE_TEMPLATES>([]);
  const [isLoadingReferences, setIsLoadingReferences] = useState(false);
  const baseline = useRef(emailStyleDraftKey('Mi estilo de correo', profile, true, 'personal'));
  const dirty = emailStyleDraftKey(styleName, profile, isDefault, libraryScope) !== baseline.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [isLoadingStyles, setIsLoadingStyles] = useState(true);
  const [stylesError, setStylesError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const [aiInstruction, setAiInstruction] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [leadOptions, setLeadOptions] = useState<ResearchLeadOption[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [isLoadingContext, setIsLoadingContext] = useState(true);
  const [leadError, setLeadError] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState(false);

  const loadStyles = useCallback(async (replaceDraft = true) => {
    if (replaceDraft && dirtyRef.current && !window.confirm('Hay cambios sin guardar. ¿Quieres descartarlos y recargar?')) return;
    setIsLoadingStyles(true);
    setStylesError(null);

    try {
      const response = await fetch('/api/email-styles', { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as
        | { styles?: SavedEmailStyle[]; error?: string; canPublish?: boolean }
        | null;

      if (!response.ok || !Array.isArray(payload?.styles)) {
        throw new Error(payload?.error || 'No se pudieron cargar los estilos.');
      }

      const nextStyles = payload.styles.map(normalizeSavedStyle);
      setStyles(nextStyles);
      setCanPublish(payload.canPublish === true);

      if (replaceDraft && nextStyles.length > 0) {
        const next = nextStyles.find((style) => style.isDefault && style.libraryScope === 'personal')
          || nextStyles.find((style) => style.isDefault) || nextStyles[0];
        setSelectedStyleId(next.id);
        setSelectedRevision(next.revision);
        setStyleName(next.name);
        setProfile(next.profile);
        setIsDefault(next.isDefault);
        setLibraryScope(next.libraryScope);
        setSourceCollection(next.sourceCollection || null);
        baseline.current = emailStyleDraftKey(next.name, next.profile, next.isDefault, next.libraryScope);
      } else if (replaceDraft) {
        const draft = createStyleDraft();
        setSelectedStyleId(''); setStyleName(draft.name); setProfile(draft);
        setSelectedRevision(undefined);
        setLibraryScope('personal'); setSourceCollection(null);
        setIsDefault(true);
        baseline.current = emailStyleDraftKey(draft.name, draft, true, 'personal');
      }
    } catch (error) {
      console.error('[email-studio/styles/get]', error);
      setStylesError('No pudimos cargar tus estilos. Puedes seguir editando o reintentar.');
    } finally {
      setIsLoadingStyles(false);
    }
  }, []);

  useEffect(() => {
    void loadStyles();
  }, [loadStyles]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    function guardNavigation(event: MouseEvent) {
      const anchor = (event.target as Element)?.closest?.('a[href]');
      if (!anchor || !dirtyRef.current || event.defaultPrevented) return;
      if (!window.confirm('Hay cambios sin guardar. ¿Quieres salir sin guardarlos?')) {
        event.preventDefault(); event.stopPropagation();
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', guardNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', guardNavigation, true);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPreviewContext() {
      setIsLoadingContext(true);
      const [leadsResult, profileResult] = await Promise.allSettled([
        getEnrichedLeads(),
        profileService.getCurrentProfile(),
      ]);

      if (!active) return;

      if (leadsResult.status === 'fulfilled') {
        const researched = (leadsResult.value || []).reduce<ResearchLeadOption[]>((items, lead) => {
          const report = reportForLead(lead);
          if (report) items.push({ lead, report });
          return items;
        }, []);
        setLeadOptions(researched);
        setSelectedLeadId((current) => current || researched[0]?.lead.id || '');
      } else {
        console.error('[email-studio/leads/get]', leadsResult.reason);
        setLeadError(true);
      }

      if (profileResult.status === 'fulfilled') {
        setCurrentProfile(profileResult.value);
      } else {
        console.error('[email-studio/profile/get]', profileResult.reason);
        setProfileError(true);
      }

      setIsLoadingContext(false);
    }

    void loadPreviewContext();
    return () => {
      active = false;
    };
  }, []);

  const selectedLeadOption = useMemo(
    () => leadOptions.find(({ lead }) => lead.id === selectedLeadId) || null,
    [leadOptions, selectedLeadId]
  );

  const companyProfile = useMemo(
    () => buildCompanyProfileInfo(currentProfile),
    [currentProfile]
  );
  const rawSender = useMemo(() => buildSenderInfo(currentProfile), [currentProfile]);
  const sender = useMemo(
    () => ({
      ...rawSender,
      name: rawSender.name || 'Tu nombre',
      title: rawSender.title || 'Tu cargo',
      email: rawSender.email || 'tu@empresa.com',
      company: rawSender.company || companyProfile.name || 'Tu empresa',
      website: rawSender.website || companyProfile.website || '',
    }),
    [companyProfile, rawSender]
  );

  const previewLead = useMemo(() => {
    const lead = selectedLeadOption?.lead;
    return {
      id: lead?.id,
      fullName: lead?.fullName || 'María González',
      email: lead?.email || 'maria@empresa.com',
      title: lead?.title || 'Directora Comercial',
      companyName: lead?.companyName || 'Empresa Ejemplo',
      companyDomain: lead?.companyDomain || 'empresa.com',
      linkedinUrl: lead?.linkedinUrl,
    };
  }, [selectedLeadOption]);

  const preview = useMemo(
    () =>
      generateMailFromStyle(
        { ...profile, name: styleName.trim() || profile.name },
        selectedLeadOption?.report || null,
        previewLead,
        { sender, companyProfile }
      ),
    [companyProfile, previewLead, profile, selectedLeadOption, sender, styleName]
  );

  const activePreset = STYLE_PRESETS.find((preset) => preset.profile.tone === profile.tone)?.id;
  const isBusy = isAdjusting || isSaving || isLoadingStyles || isLoadingReferences;
  const readOnly = libraryScope === 'team' && !canPublish;

  function discardChanges() {
    return !dirty || window.confirm('Hay cambios sin guardar. ¿Quieres descartarlos?');
  }

  function selectSavedStyle(id: string) {
    if (!discardChanges()) return;
    const next = styles.find((style) => style.id === id);
    if (!next) return;
    setSelectedStyleId(next.id);
    setSelectedRevision(next.revision);
    setStyleName(next.name);
    setProfile(next.profile);
    setIsDefault(next.isDefault);
    setLibraryScope(next.libraryScope);
    setSourceCollection(next.sourceCollection || null);
    baseline.current = emailStyleDraftKey(next.name, next.profile, next.isDefault, next.libraryScope);
    setNameError(null);
    setSaveError(null);
    setSaveStatus(null);
    setAiError(null);
    setAiFeedback(null);
  }

  function startNewStyle() {
    if (!discardChanges()) return;
    const draft = createStyleDraft();
    setSelectedStyleId('');
    setSelectedRevision(undefined);
    setStyleName(draft.name);
    setProfile(draft);
    setIsDefault(styles.length === 0);
    setLibraryScope('personal');
    setSourceCollection(null);
    baseline.current = emailStyleDraftKey(draft.name, draft, styles.length === 0, 'personal');
    setNameError(null);
    setSaveError(null);
    setSaveStatus(null);
    setAiError(null);
    setAiFeedback(null);
    window.requestAnimationFrame(() => styleNameRef.current?.focus());
  }

  function applyPreset(presetId: PresetId) {
    if (!discardChanges()) return;
    const preset = STYLE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setProfile((current) => ({ ...current, ...preset.profile }));
    setSaveStatus(null);
    setAiFeedback(null);
  }

  async function loadReferences() {
    setIsLoadingReferences(true); setSaveError(null);
    try {
      const response = await fetch('/api/email-styles?referenceCollection=grupoexpro', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.references)) throw new Error(payload.error);
      setReferences(payload.references);
    } catch (error) { setSaveError(emailLibraryError(error)); }
    finally { setIsLoadingReferences(false); }
  }

  function useReference(id: string) {
    if (!discardChanges()) return;
    const reference = references.find((item) => item.id === id);
    if (!reference) return;
    setSelectedStyleId(''); setStyleName(reference.name); setProfile(reference.profile);
    setSelectedRevision(undefined);
    setLibraryScope('personal'); setIsDefault(false); setSourceCollection('grupoexpro');
    setSaveError(null); setSaveStatus(null);
    // A reference remains an unsaved draft until an explicit save or publication.
    baseline.current = '';
  }

  async function adjustWithAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instruction = aiInstruction.trim();
    if (!instruction || isBusy || readOnly) return;

    setIsAdjusting(true);
    setAiError(null);
    setAiFeedback(null);
    setSaveStatus(null);

    try {
      const response = await fetch('/api/email/style/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: instruction }],
          styleProfile: { ...profile, name: styleName.trim() || profile.name },
          mode: 'leads',
          sampleData: {
            lead: selectedLeadOption?.lead || previewLead,
            report: selectedLeadOption?.report || null,
            companyProfile,
            sender,
            leadId: selectedLeadOption?.lead.id,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { styleProfile?: StyleProfile; explanation?: string; error?: string }
        | null;

      if (!response.ok || !payload?.styleProfile) {
        throw new Error(payload?.error || 'No se pudo aplicar el ajuste.');
      }

      setProfile((current) => ({
        ...current,
        ...payload.styleProfile,
        id: current.id,
        isDefault,
        name: styleName.trim() || current.name,
        updatedAt: new Date().toISOString(),
      }));
      setAiInstruction('');
      setAiFeedback(payload.explanation?.trim() || 'Ajuste aplicado. Revisa el correo antes de guardar.');
    } catch (error) {
      console.error('[email-studio/style/chat]', error);
      setAiError('No pudimos aplicar el ajuste. Inténtalo de nuevo.');
    } finally {
      setIsAdjusting(false);
    }
  }

  async function saveStyle(action: 'save' | 'duplicate' | 'archive' = 'save', targetScope = libraryScope) {
    if (isBusy || (readOnly && action !== 'duplicate')) return;
    if (action !== 'save' && !discardChanges()) return;
    if (action === 'archive' && !window.confirm('¿Archivar esta plantilla? Dejaria de estar disponible para nuevos correos.')) return;
    const publishConfirmed = targetScope === 'team'
      ? window.confirm('¿Confirmas que revisaste el contenido y autorizas su publicacion para tu equipo? Esto no acredita aprobacion de marketing externa.') : false;
    if (targetScope === 'team' && !publishConfirmed) return;
    const name = styleName.trim();
    if (!name) {
      setNameError('Escribe un nombre para guardar este estilo.');
      styleNameRef.current?.focus();
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveStatus(null);
    setNameError(null);

    const selected = styles.find((style) => style.id === selectedStyleId);
    const profileToSave: StyleProfile = {
      ...profile,
      id: selected?.id || profile.id,
      isDefault,
      name,
      scope: 'leads',
    };

    try {
      const response = await fetch('/api/email-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedStyleId || undefined,
          expectedRevision: selectedStyleId ? selectedRevision : undefined,
          action,
          libraryScope: targetScope,
          publishConfirmed,
          sourceCollection,
          name: action === 'duplicate' ? `${name.slice(0, 110)} (copia)` : name,
          profile: profileToSave,
          isDefault: action === 'save' ? isDefault : false,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { style?: SavedEmailStyle; error?: string }
        | null;

      if (!response.ok || !payload?.style) {
        throw new Error(payload?.error || 'No se pudo guardar el estilo.');
      }

      const saved = normalizeSavedStyle(payload.style);
      if (action === 'archive') {
        const draft = createStyleDraft();
        setStyles((current) => current.filter((style) => style.id !== saved.id));
        setSelectedStyleId(''); setSelectedRevision(undefined);
        setStyleName(draft.name); setProfile(draft); setIsDefault(false);
        setLibraryScope('personal'); setSourceCollection(null);
        baseline.current = emailStyleDraftKey(draft.name, draft, false, 'personal');
        dirtyRef.current = false;
        await loadStyles();
        setSaveStatus('Plantilla archivada.');
        return;
      }
      setStyles((current) => {
        const reconciled = saved.isDefault
          ? current.map((style) => style.libraryScope === saved.libraryScope ? ({
              ...style,
              isDefault: false,
              profile: { ...style.profile, isDefault: false },
            }) : style)
          : current;
        const index = reconciled.findIndex((style) => style.id === saved.id);
        if (index < 0) return [saved, ...reconciled];
        return reconciled.map((style, itemIndex) => (itemIndex === index ? saved : style));
      });
      setSelectedStyleId(saved.id);
      setSelectedRevision(saved.revision);
      setStyleName(saved.name);
      setProfile(saved.profile);
      setIsDefault(saved.isDefault);
      setLibraryScope(saved.libraryScope);
      setSourceCollection(saved.sourceCollection || null);
      baseline.current = emailStyleDraftKey(saved.name, saved.profile, saved.isDefault, saved.libraryScope);
      await loadStyles(false);
      setSaveStatus('Estilo guardado.');
      toast({
        title: 'Estilo guardado',
        description: `${saved.name} ya está disponible.`,
      });
    } catch (error) {
      console.error('[email-studio/styles/post]', error);
      setSaveError(emailLibraryError(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-label="Diseñador de estilo de correo"
      className="min-w-0 overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_22px_70px_-52px_rgba(15,23,42,0.45)] dark:shadow-[0_22px_70px_-52px_rgba(0,0,0,0.9)]"
    >
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <section aria-labelledby="style-definition-title" className="min-w-0 p-4 sm:p-7 lg:border-r lg:border-border/70">
          <div className="max-w-xl">
            <h2 id="style-definition-title" className="text-xl font-semibold tracking-tight text-foreground">
              Define tu estilo
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Describe una voz consistente y comprueba el resultado antes de guardarla.
            </p>
          </div>

          <div className="mt-7 space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="saved-email-style">Estilos guardados</Label>
                <Button type="button" variant="ghost" size="sm" onClick={startNewStyle} disabled={isBusy} className="h-8 px-2 text-muted-foreground">
                  <Plus aria-hidden="true" />
                  Nuevo
                </Button>
              </div>

              {isLoadingStyles ? (
                <div className="space-y-2" aria-live="polite">
                  <Skeleton className="h-11 w-full rounded-xl" />
                  <span className="sr-only">Cargando estilos guardados</span>
                </div>
              ) : styles.length > 0 ? (
                <Select value={selectedStyleId || undefined} onValueChange={selectSavedStyle} disabled={isBusy}>
                  <SelectTrigger id="saved-email-style" className="h-11 rounded-xl bg-background">
                    <SelectValue placeholder="Selecciona un estilo" />
                  </SelectTrigger>
                  <SelectContent>
                    {styles.map((style) => (
                      <SelectItem key={style.id} value={style.id}>
                        {style.name} · {style.libraryScope === 'team' ? 'Equipo' : 'Personal'}{style.isDefault ? ' · Predeterminado' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div id="saved-email-style" className="rounded-xl border border-dashed border-border bg-muted/25 px-3 py-3 text-sm text-muted-foreground">
                  {stylesError
                    ? 'Tus estilos guardados no están disponibles ahora.'
                    : 'Aún no hay estilos guardados. Define el primero y guárdalo cuando esté listo.'}
                </div>
              )}

              {stylesError ? (
                <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200 sm:flex-row sm:justify-between">
                  <span className="flex min-w-0 items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {stylesError}
                  </span>
                  <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={() => void loadStyles()} className="h-7 shrink-0 px-2 text-current hover:bg-rose-100 dark:hover:bg-rose-900/40">
                    <RefreshCw aria-hidden="true" />
                    Reintentar
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={() => void loadStyles()}>Recargar biblioteca</Button>
                {selectedStyleId ? <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void saveStyle('duplicate', 'personal')}>Duplicar en Personal</Button> : null}
                {selectedStyleId && canPublish && libraryScope === 'personal' ? <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void saveStyle('duplicate', 'team')}>Publicar copia para el equipo</Button> : null}
                {selectedStyleId && !readOnly ? <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={() => void saveStyle('archive')}>Archivar</Button> : null}
              </div>
              {readOnly ? <p className="text-sm text-muted-foreground">Plantilla del equipo. Puedes duplicarla en tu espacio personal para editarla.</p> : null}
              <details className="rounded-xl border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Importar referencias de servicio</summary>
                <p className="my-3 text-xs leading-5 text-muted-foreground">Referencias editables inspiradas en GrupoExpro, sin aprobacion de marketing acreditada. No se agregan al equipo hasta que un administrador las revise y publique.</p>
                {references.length === 0 ? <Button type="button" variant="outline" disabled={isBusy} onClick={() => void loadReferences()}>Ver referencias GrupoExpro</Button> : (
                  <div className="space-y-2">
                    <Label htmlFor="email-reference">Servicio de referencia</Label>
                    <Select onValueChange={useReference} disabled={isBusy} value="">
                      <SelectTrigger id="email-reference"><SelectValue placeholder="Elegir una referencia editable" /></SelectTrigger>
                      <SelectContent>{references.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </details>
            </div>

            <fieldset disabled={isBusy || readOnly} className="min-w-0 space-y-6">
            <legend className="sr-only">Editar plantilla</legend>
            {!selectedStyleId ? <div className="space-y-2">
              <Label htmlFor="email-library-scope">Guardar en</Label>
              <Select value={libraryScope} onValueChange={(value) => setLibraryScope(value as EmailLibraryScope)} disabled={isBusy}>
                <SelectTrigger id="email-library-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal: solo yo</SelectItem>
                  {canPublish ? <SelectItem value="team">Equipo: publicar tras revision</SelectItem> : null}
                </SelectContent>
              </Select>
            </div> : null}
            <div className="space-y-2">
              <Label htmlFor="email-style-name">Nombre del estilo</Label>
              <Input
                ref={styleNameRef}
                id="email-style-name"
                value={styleName}
                onChange={(event) => {
                  setStyleName(event.target.value);
                  setNameError(null);
                  setSaveStatus(null);
                }}
                onBlur={() => setNameError(styleName.trim() ? null : 'Escribe un nombre para guardar este estilo.')}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'email-style-name-error' : undefined}
                disabled={isBusy}
                maxLength={120}
                className="h-11 rounded-xl"
              />
              {nameError ? <p id="email-style-name-error" className="text-sm text-rose-600 dark:text-rose-300">{nameError}</p> : null}
            </div>

            <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-3.5 py-3">
              <div className="min-w-0">
                <Label htmlFor="email-style-default">Usar como predeterminado</Label>
                <p id="email-style-default-description" className="mt-1 text-xs leading-5 text-muted-foreground">
                  {isDefault
                    ? 'Se elegirá automáticamente al crear nuevos correos.'
                    : 'Se guardará como una alternativa que podrás elegir manualmente.'}
                </p>
              </div>
              <Switch
                id="email-style-default"
                checked={isDefault}
                onCheckedChange={(checked) => {
                  setIsDefault(checked);
                  setSaveStatus(null);
                  setSaveError(null);
                }}
                aria-describedby="email-style-default-description"
                disabled={isBusy}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">Punto de partida</legend>
              <div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                {STYLE_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    aria-pressed={activePreset === preset.id}
                    onClick={() => applyPreset(preset.id)}
                    disabled={isBusy}
                    className={cn(
                      'h-11 min-w-0 rounded-xl bg-background px-2',
                      activePreset === preset.id && 'border-primary bg-primary/5 text-primary hover:bg-primary/10'
                    )}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              {activePreset ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {STYLE_PRESETS.find((preset) => preset.id === activePreset)?.description}
                </p>
              ) : null}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="email-template-subject">Asunto de la plantilla</Label>
              <Input id="email-template-subject" value={profile.subjectTemplate || ''} maxLength={500}
                onChange={(event) => { setProfile((current) => ({ ...current, subjectTemplate: event.target.value })); setSaveStatus(null); }} />
              <Label htmlFor="email-template-body">Cuerpo de la plantilla</Label>
              <Textarea id="email-template-body" value={profile.bodyTemplate || ''} rows={10} maxLength={30000}
                className="resize-y rounded-xl leading-6" aria-describedby="email-template-tokens"
                onChange={(event) => { setProfile((current) => ({ ...current, bodyTemplate: event.target.value })); setSaveStatus(null); }} />
              <p id="email-template-tokens" className="text-xs leading-5 text-muted-foreground">Variables: {'{{lead.firstName}}'}, {'{{company.name}}'}, {'{{sender.name}}'} y {'{{sender.company}}'}. Revisa el resultado antes de enviar.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-style-instructions">Cómo debe sonar</Label>
              <Textarea
                id="email-style-instructions"
                value={profile.instructions || ''}
                onChange={(event) => {
                  setProfile((current) => ({ ...current, instructions: event.target.value }));
                  setSaveStatus(null);
                  setAiFeedback(null);
                }}
                disabled={isBusy}
                maxLength={800}
                rows={5}
                placeholder="Ej. cercano, concreto y sin jerga; abre con una observación relevante y evita promesas absolutas."
                className="min-h-[132px] resize-y rounded-xl leading-6"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Esta guía se guarda con el estilo y acompaña sus próximos correos.
              </p>
            </div>

            <form onSubmit={adjustWithAi} className="space-y-2">
              <Label htmlFor="email-style-ai-adjustment">Ajuste con IA</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="email-style-ai-adjustment"
                  value={aiInstruction}
                  onChange={(event) => {
                    setAiInstruction(event.target.value);
                    setAiError(null);
                    setAiFeedback(null);
                  }}
                  disabled={isBusy}
                  maxLength={500}
                  placeholder="Ej. hazlo más breve y menos vendedor"
                  className="h-11 rounded-xl"
                />
                <Button type="submit" variant="secondary" disabled={!aiInstruction.trim() || isBusy} className="h-11 rounded-xl sm:shrink-0">
                  {isAdjusting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  {isAdjusting ? 'Aplicando…' : 'Aplicar'}
                </Button>
              </div>
              <div aria-live="polite">
                {aiError ? <p className="text-sm text-rose-600 dark:text-rose-300">{aiError}</p> : null}
                {aiFeedback ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{aiFeedback}</p> : null}
              </div>
            </form>

            <div className="border-t border-border/70 pt-5">
              <Button type="button" onClick={() => void saveStyle()} disabled={!styleName.trim() || isBusy} className="h-11 w-full rounded-xl sm:w-auto">
                {isSaving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                {isSaving ? 'Guardando…' : libraryScope === 'team' ? 'Revisar y publicar' : 'Guardar estilo'}
              </Button>
              <div className="mt-2 min-h-5" aria-live="polite">
                {saveError ? <p className="text-sm text-rose-600 dark:text-rose-300">{saveError}</p> : null}
                {saveStatus ? (
                  <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {saveStatus}
                  </p>
                ) : null}
              </div>
            </div>
            </fieldset>
            {dirty ? <p role="status" className="text-xs text-muted-foreground">Hay cambios sin guardar.</p> : null}
          </div>
        </section>

        <section aria-labelledby="email-preview-title" className="min-w-0 bg-muted/20 p-4 sm:p-7">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 id="email-preview-title" className="text-xl font-semibold tracking-tight text-foreground">Vista previa</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Vista ilustrativa, no es el borrador final ni una validacion de afirmaciones. Se actualiza mientras editas.</p>
              <p className="mt-2 max-w-2xl break-words text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">Guía activa:</span>{' '}
                {profile.instructions?.trim() || 'Sin instrucciones adicionales.'}
              </p>
            </div>

            <div className="w-full min-w-0 sm:w-[270px] sm:shrink-0">
              {isLoadingContext ? (
                <div className="space-y-2" aria-live="polite">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                  <span className="sr-only">Cargando contexto de vista previa</span>
                </div>
              ) : leadOptions.length > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="email-preview-lead">Lead investigado</Label>
                  <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                    <SelectTrigger id="email-preview-lead" className="rounded-xl bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {leadOptions.map(({ lead }) => (
                        <SelectItem key={lead.id} value={lead.id}>
                          {lead.fullName}{lead.companyName ? ` · ${lead.companyName}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  {leadError
                    ? 'No pudimos cargar tus leads. Usamos un ejemplo temporal.'
                    : 'Cuando investigues un lead, podrás previsualizar aquí con sus datos reales.'}
                </p>
              )}
            </div>
          </div>

          <article aria-labelledby="preview-email-subject" aria-busy={isAdjusting} className="mt-6 min-w-0 overflow-hidden rounded-[22px] border border-border/80 bg-background shadow-[0_20px_55px_-44px_rgba(15,23,42,0.5)] dark:shadow-[0_20px_55px_-44px_rgba(0,0,0,0.95)]">
            <header className="min-w-0 border-b border-border/70 px-4 py-5 sm:px-7">
              <div className="flex min-w-0 flex-col items-start gap-2 text-xs text-muted-foreground min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
                  Correo nuevo
                </span>
                <span>{toneLabel(profile.tone)} · {profile.length === 'short' ? 'Breve' : profile.length === 'long' ? 'Extenso' : 'Medio'}</span>
              </div>
              <h3 id="preview-email-subject" className="mt-5 break-words text-lg font-semibold leading-7 tracking-tight text-foreground sm:text-xl">
                {preview.subject || 'Sin asunto'}
              </h3>
              <dl className="mt-4 space-y-1.5 text-xs leading-5 text-muted-foreground sm:text-sm">
                <div className="flex min-w-0 gap-2">
                  <dt className="w-9 shrink-0">De</dt>
                  <dd className="min-w-0 truncate text-foreground">{sender.name} &lt;{sender.email}&gt;</dd>
                </div>
                <div className="flex min-w-0 gap-2">
                  <dt className="w-9 shrink-0">Para</dt>
                  <dd className="min-w-0 truncate text-foreground">{previewLead.fullName} &lt;{previewLead.email}&gt;</dd>
                </div>
              </dl>
            </header>

            <div className="min-h-[360px] min-w-0 px-4 py-7 sm:px-8 sm:py-9">
              <div className="space-y-5 break-words text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]">
                {(preview.body || 'El correo aparecerá aquí.').split(/\n\n+/).map((paragraph, index) => (
                  <p key={`${index}-${paragraph.slice(0, 24)}`} className="whitespace-pre-line">{paragraph}</p>
                ))}
              </div>
            </div>

            <footer className="break-words border-t border-border/70 bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-7">
              {selectedLeadOption
                ? `Vista con la investigación de ${previewLead.companyName}.`
                : 'Vista con datos de ejemplo.'}{' '}
              Remitente: {sender.name} · {sender.company}.
              {profileError ? ' Completa tu perfil para usar tus datos reales.' : ''}
            </footer>
          </article>
        </section>
      </div>
    </section>
  );
}
