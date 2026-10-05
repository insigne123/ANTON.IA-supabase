'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2, Mail, MoreHorizontal, Plus, RefreshCw, Save, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/confirm-dialog';
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
import { buildSignatureHtml } from '@/lib/email-studio/signature-builder';
import { EMAIL_VARIABLES, friendlyToken, toCanonicalTemplate, toFriendlyTemplate, type EmailVariable } from '@/lib/email-studio/variables';
import { emailSignatureStorage } from '@/lib/email-signature-storage';
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

/** The voices a style can take, as chips: the first is what the AI writes by default. */
const TONES: Array<{ id: NonNullable<StyleProfile['tone']>; label: string }> = [
  { id: 'professional', label: 'Profesional' }, { id: 'warm', label: 'Cercano' }, { id: 'direct', label: 'Directo' },
  { id: 'consultative', label: 'Consultivo' }, { id: 'challenger', label: 'Desafiante' }, { id: 'executive', label: 'Ejecutivo' },
  { id: 'commercial', label: 'Comercial' }, { id: 'brief', label: 'Muy breve' },
];
const LENGTHS: Array<{ id: NonNullable<StyleProfile['length']>; label: string }> = [
  { id: 'short', label: 'Breve' }, { id: 'medium', label: 'Medio' }, { id: 'long', label: 'Extenso' },
];

/** Where a style reaches, said plainly (Plan 11): the default one is used whenever nobody picks another. */
function styleUse(style: Pick<SavedEmailStyle, 'isDefault'>) {
  return style.isDefault
    ? 'Se usa solo cuando no eliges otro: Redactar, Secuencias, Investigación, Campañas y Cowork.'
    : 'Elígelo al redactar, en una secuencia, en la investigación o al armar una campaña.';
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

export default function EmailStyleDesigner({ onOpenSignature, signatureVersion = 0 }: {
  /** Opens «Firma» from the preview, when the page has it. */
  onOpenSignature?: () => void;
  /** Changes when the signature is saved, so the preview shows the new one. */
  signatureVersion?: number;
} = {}) {
  const { toast } = useToast();
  const confirm = useConfirm();
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
  // The service references are GrupoExpro's: the server offers them only to those accounts.
  const [referencesAvailable, setReferencesAvailable] = useState(false);
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
  // The signature that goes out with every email (PR 3a), shown at the end of the preview.
  const [signatureHtml, setSignatureHtml] = useState('');
  const [signatureOn, setSignatureOn] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const loadStyles = useCallback(async (replaceDraft = true) => {
    if (replaceDraft && dirtyRef.current && !window.confirm('Hay cambios sin guardar. ¿Quieres descartarlos y recargar?')) return;
    setIsLoadingStyles(true);
    setStylesError(null);

    try {
      const response = await fetch('/api/email-styles', { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as
        | { styles?: SavedEmailStyle[]; error?: string; canPublish?: boolean; referencesAvailable?: boolean }
        | null;

      if (!response.ok || !Array.isArray(payload?.styles)) {
        throw new Error(payload?.error || 'No se pudieron cargar los estilos.');
      }

      const nextStyles = payload.styles.map(normalizeSavedStyle);
      setStyles(nextStyles);
      setCanPublish(payload.canPublish === true);
      setReferencesAvailable(payload.referencesAvailable === true);

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

  // The signature at the end of the preview: read again whenever «Firma» saves one.
  useEffect(() => {
    let active = true;
    void emailSignatureStorage.get('gmail')
      .then(async (gmail) => gmail || emailSignatureStorage.get('outlook'))
      .then((saved) => {
        if (!active) return;
        // Rebuilt from its fields (or its image), never the stored HTML as is.
        const image = saved?.html?.match(/<img[^>]+src="(https:[^"]+)"/i)?.[1] || '';
        setSignatureHtml(saved?.builder ? buildSignatureHtml(saved.builder.fields, saved.builder.design) : image ? buildSignatureHtml({ imageUrl: image }, 'imagen') : '');
        setSignatureOn(saved?.enabled === true);
      })
      .catch((error) => console.error('[email-studio/signature/get]', error));
    return () => {
      active = false;
    };
  }, [signatureVersion]);

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

  /** «Más» on a card: copy, publish or archive that style, leaving the editor as it is unless it shows that style. */
  async function runCardAction(style: SavedEmailStyle, action: 'duplicate' | 'archive', targetScope: EmailLibraryScope = 'personal') {
    if (isBusy) return;
    if (action === 'archive' && !(await confirm({
      title: `¿Archivar «${style.name}»?`, description: 'Dejará de estar disponible para correos nuevos.', confirmLabel: 'Archivar', tone: 'danger',
    }))) return;
    const publishConfirmed = targetScope === 'team'
      ? await confirm({
        title: '¿Publicar para tu equipo?',
        description: 'Confirmas que revisaste el contenido y autorizas que tu equipo lo use. Esto no reemplaza una aprobación de marketing externa.',
        confirmLabel: 'Publicar',
      }) : false;
    if (targetScope === 'team' && !publishConfirmed) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await fetch('/api/email-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: style.id, expectedRevision: style.revision, action, libraryScope: action === 'archive' ? style.libraryScope : targetScope,
          publishConfirmed, sourceCollection: style.sourceCollection || null,
          name: action === 'duplicate' ? `${style.name.slice(0, 110)} (copia)` : style.name,
          profile: { ...style.profile, scope: 'leads' }, isDefault: false,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { style?: SavedEmailStyle; error?: string } | null;
      if (!response.ok || !payload?.style) throw new Error(payload?.error || 'No se pudo completar la acción.');
      if (action === 'archive' && style.id === selectedStyleId) {
        const draft = createStyleDraft();
        setSelectedStyleId(''); setSelectedRevision(undefined); setStyleName(draft.name); setProfile(draft); setIsDefault(false);
        setLibraryScope('personal'); setSourceCollection(null);
        baseline.current = emailStyleDraftKey(draft.name, draft, false, 'personal');
        dirtyRef.current = false;
      }
      await loadStyles(false);
      const done = action === 'archive' ? 'archivado' : targetScope === 'team' ? 'publicado para tu equipo' : 'copiado en tu espacio personal';
      setSaveStatus(`«${style.name}» ${done}.`);
      toast({ title: action === 'archive' ? 'Estilo archivado' : 'Listo', description: `«${style.name}» ${done}.` });
    } catch (error) {
      console.error('[email-studio/styles/card]', error);
      setSaveError(emailLibraryError(error));
    } finally {
      setIsSaving(false);
    }
  }

  /** «Insertar: Nombre» puts «{Nombre}» where the cursor is; what is stored stays `{{lead.firstName}}`. */
  function insertVariable(field: 'subjectTemplate' | 'bodyTemplate', variable: EmailVariable) {
    const element = field === 'subjectTemplate' ? subjectRef.current : bodyRef.current;
    const current = toFriendlyTemplate(profile[field] || '');
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? start;
    const token = friendlyToken(variable);
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    setProfile((value) => ({ ...value, [field]: toCanonicalTemplate(next) }));
    setSaveStatus(null);
    window.requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
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
    if (action === 'archive' && !(await confirm({
      title: '¿Archivar esta plantilla?', description: 'Dejará de estar disponible para correos nuevos.', confirmLabel: 'Archivar', tone: 'danger',
    }))) return;
    const publishConfirmed = targetScope === 'team'
      ? await confirm({
        title: '¿Publicar para tu equipo?',
        description: 'Confirmas que revisaste el contenido y autorizas que tu equipo lo use. Esto no reemplaza una aprobación de marketing externa.',
        confirmLabel: 'Publicar',
      }) : false;
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

  const selectedStyle = styles.find((style) => style.id === selectedStyleId) || null;
  const lengthLabel = (length: StyleProfile['length']) => LENGTHS.find((item) => item.id === length)?.label || 'Medio';
  const pills = (field: 'subjectTemplate' | 'bodyTemplate', label: string) => (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Insertar en ${label}`}>
      <span className="text-xs text-muted-foreground">Insertar:</span>
      {EMAIL_VARIABLES.map((variable) => (
        <button key={variable.token} type="button" title={variable.hint} onClick={() => insertVariable(field, variable)}
          className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          {variable.label}
        </button>
      ))}
    </div>
  );
  const step = (number: number, title: string, description: string) => (
    <div className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden="true">{number}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground"><span className="sr-only">Paso {number}: </span>{title}</p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );

  return (
    <div className="min-w-0 space-y-6">
      <section aria-labelledby="styles-gallery-title" className="min-w-0 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="styles-gallery-title" className="text-lg font-semibold tracking-tight text-foreground">Tus estilos</h2>
            <p className="text-sm leading-6 text-muted-foreground">Un estilo dice cómo suenan los correos que la IA te prepara. El predeterminado se usa solo.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" onClick={startNewStyle} disabled={isBusy}>
              <Plus className="h-4 w-4" aria-hidden="true" />Crear estilo
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Más opciones de la biblioteca" disabled={isBusy}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void loadStyles()}>Recargar estilos</DropdownMenuItem>
                {referencesAvailable ? (
                  <DropdownMenuItem onSelect={() => void loadReferences()}>Ver referencias de servicio</DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {stylesError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <span className="flex min-w-0 items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{stylesError}</span>
            <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={() => void loadStyles()} className="h-7 shrink-0 px-2 text-current">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />Reintentar
            </Button>
          </div>
        ) : null}

        {isLoadingStyles ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-40 w-full rounded-2xl" />)}
            <span className="sr-only">Cargando tus estilos</span>
          </div>
        ) : styles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <p className="font-medium text-foreground">Aún no tienes estilos guardados</p>
            <p className="mt-1 text-sm text-muted-foreground">Arma el primero abajo: elige un punto de partida, el tono y guárdalo.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Estilos guardados">
            {styles.map((style) => {
              const open = style.id === selectedStyleId;
              const canEdit = style.libraryScope === 'personal' || canPublish;
              return (
                <li key={style.id} className="min-w-0">
                  <article aria-label={style.name} className={cn('flex h-full min-w-0 flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-sm', open && 'border-primary ring-1 ring-primary/30')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium text-foreground">{style.name}</h3>
                        <p className="text-xs text-muted-foreground">{toneLabel(style.profile.tone)} · {lengthLabel(style.profile.length)}</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Más acciones de «${style.name}»`} disabled={isBusy}>
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel className="max-w-56 truncate">{style.name}</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={() => void runCardAction(style, 'duplicate', 'personal')}>Duplicar en Personal</DropdownMenuItem>
                          {canPublish && style.libraryScope === 'personal' ? (
                            <DropdownMenuItem onSelect={() => void runCardAction(style, 'duplicate', 'team')}>Publicar copia para el equipo</DropdownMenuItem>
                          ) : null}
                          {canEdit ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void runCardAction(style, 'archive')}>Archivar</DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {style.isDefault ? <Badge variant="success">Predeterminado</Badge> : null}
                      <Badge variant={style.libraryScope === 'team' ? 'info' : 'neutral'}>{style.libraryScope === 'team' ? 'Equipo' : 'Personal'}</Badge>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-foreground/80">{style.profile.instructions?.trim() || 'Sin guía escrita.'}</p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{styleUse(style)}</p>
                    <div className="mt-auto pt-3">
                      <Button type="button" size="sm" variant={open ? 'secondary' : 'outline'} aria-pressed={open} onClick={() => selectSavedStyle(style.id)} disabled={isBusy}>
                        {open ? 'Abierto abajo' : canEdit ? 'Editar' : 'Ver'}
                      </Button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        {references.length > 0 ? (
          <div className="max-w-md space-y-2 rounded-xl border border-border/70 p-3">
            <Label htmlFor="email-reference">Partir de una referencia de servicio</Label>
            <p className="text-xs leading-5 text-muted-foreground">Referencias editables, sin aprobación de marketing acreditada. No llegan al equipo hasta que un administrador las revise y publique.</p>
            <Select onValueChange={useReference} disabled={isBusy} value="">
              <SelectTrigger id="email-reference"><SelectValue placeholder="Elegir una referencia" /></SelectTrigger>
              <SelectContent>{references.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="style-definition-title" className="min-w-0 overflow-hidden rounded-[24px] border border-border/70 bg-card shadow-sm">
        <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6 p-4 sm:p-6 lg:border-r lg:border-border/70">
            <div>
              <h2 id="style-definition-title" className="text-lg font-semibold tracking-tight text-foreground">
                {selectedStyle ? `Editando «${selectedStyle.name}»` : 'Nuevo estilo'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Tres pasos. La vista previa cambia mientras editas.</p>
              {readOnly ? <p className="mt-2 text-sm text-muted-foreground">Es un estilo del equipo. Para cambiarlo, usa «Duplicar en Personal» en su tarjeta.</p> : null}
            </div>

            <fieldset disabled={isBusy || readOnly} className="min-w-0 space-y-7">
              <legend className="sr-only">Editar el estilo</legend>

              <div className="space-y-3">
                {step(1, 'Punto de partida', 'Una estructura probada. Puedes cambiarla después.')}
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  {STYLE_PRESETS.map((preset) => (
                    <button key={preset.id} type="button" aria-pressed={activePreset === preset.id} onClick={() => applyPreset(preset.id)}
                      className={cn('min-w-0 rounded-xl border border-border/70 bg-background p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                        activePreset === preset.id && 'border-primary bg-primary/5')}>
                      <span className="block text-sm font-medium text-foreground">{preset.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{preset.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {step(2, 'Tono y largo', 'Cómo suena y cuánto se extiende.')}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tono">
                  {TONES.map((tone) => (
                    <button key={tone.id} type="button" aria-pressed={profile.tone === tone.id}
                      onClick={() => { setProfile((current) => ({ ...current, tone: tone.id })); setSaveStatus(null); }}
                      className={cn('rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                        profile.tone === tone.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-background text-foreground hover:bg-muted/50')}>
                      {tone.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Largo">
                  {LENGTHS.map((length) => (
                    <button key={length.id} type="button" aria-pressed={(profile.length || 'medium') === length.id}
                      onClick={() => { setProfile((current) => ({ ...current, length: length.id })); setSaveStatus(null); }}
                      className={cn('rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                        (profile.length || 'medium') === length.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-background text-foreground hover:bg-muted/50')}>
                      {length.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                {step(3, 'En tus palabras', 'Lo que la IA debe cuidar, y si quieres, el correo base con sus variables.')}
                <div className="space-y-2">
                  <Label htmlFor="email-style-instructions">Cómo debe sonar</Label>
                  <Textarea id="email-style-instructions" value={profile.instructions || ''} maxLength={800} rows={4}
                    placeholder="Ej. cercano, concreto y sin jerga; abre con algo de su empresa y evita promesas absolutas."
                    className="resize-y rounded-xl leading-6"
                    onChange={(event) => { setProfile((current) => ({ ...current, instructions: event.target.value })); setSaveStatus(null); setAiFeedback(null); }} />
                </div>

                <form onSubmit={adjustWithAi} className="space-y-2">
                  <Label htmlFor="email-style-ai-adjustment">Pídele un ajuste a la IA</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input id="email-style-ai-adjustment" value={aiInstruction} maxLength={500} placeholder="Ej. hazlo más breve y menos vendedor"
                      onChange={(event) => { setAiInstruction(event.target.value); setAiError(null); setAiFeedback(null); }} />
                    <Button type="submit" variant="secondary" disabled={!aiInstruction.trim() || isBusy} className="sm:shrink-0">
                      {isAdjusting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                      {isAdjusting ? 'Ajustando…' : 'Ajustar'}
                    </Button>
                  </div>
                  <div aria-live="polite">
                    {aiError ? <p className="text-sm text-destructive">{aiError}</p> : null}
                    {aiFeedback ? <p className="text-sm text-cw-success">{aiFeedback}</p> : null}
                  </div>
                </form>

                <div className="space-y-2">
                  <Label htmlFor="email-template-subject">Asunto</Label>
                  <Input ref={subjectRef} id="email-template-subject" value={toFriendlyTemplate(profile.subjectTemplate || '')} maxLength={500}
                    onChange={(event) => { setProfile((current) => ({ ...current, subjectTemplate: toCanonicalTemplate(event.target.value) })); setSaveStatus(null); }} />
                  {pills('subjectTemplate', 'el asunto')}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-template-body">Correo base</Label>
                  <Textarea ref={bodyRef} id="email-template-body" value={toFriendlyTemplate(profile.bodyTemplate || '')} rows={9} maxLength={30000}
                    className="resize-y rounded-xl leading-6" aria-describedby="email-template-tokens"
                    onChange={(event) => { setProfile((current) => ({ ...current, bodyTemplate: toCanonicalTemplate(event.target.value) })); setSaveStatus(null); }} />
                  {pills('bodyTemplate', 'el correo')}
                  <p id="email-template-tokens" className="text-xs leading-5 text-muted-foreground">
                    Lo que va entre llaves, como {'{Nombre}'} o {'{Empresa}'}, se reemplaza por los datos de cada persona. La firma se agrega al enviar.
                  </p>
                </div>
              </div>

              <div className="space-y-4 border-t border-border/70 pt-5">
                {!selectedStyleId && canPublish ? (
                  <div className="space-y-2">
                    <Label htmlFor="email-library-scope">Guardar en</Label>
                    <Select value={libraryScope} onValueChange={(value) => setLibraryScope(value as EmailLibraryScope)} disabled={isBusy}>
                      <SelectTrigger id="email-library-scope"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="personal">Personal: solo yo</SelectItem>
                        <SelectItem value="team">Equipo: publicar tras revisión</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="email-style-name">Nombre del estilo</Label>
                  <Input ref={styleNameRef} id="email-style-name" value={styleName} maxLength={120}
                    onChange={(event) => { setStyleName(event.target.value); setNameError(null); setSaveStatus(null); }}
                    onBlur={() => setNameError(styleName.trim() ? null : 'Escribe un nombre para guardar este estilo.')}
                    aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'email-style-name-error' : undefined} />
                  {nameError ? <p id="email-style-name-error" className="text-sm text-destructive">{nameError}</p> : null}
                </div>
                <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-3.5 py-3">
                  <div className="min-w-0">
                    <Label htmlFor="email-style-default">Usar como predeterminado</Label>
                    <p id="email-style-default-description" className="mt-1 text-xs leading-5 text-muted-foreground">
                      {isDefault ? styleUse({ isDefault: true }) : 'Quedará como alternativa para elegir a mano.'}
                    </p>
                  </div>
                  <Switch id="email-style-default" checked={isDefault} aria-describedby="email-style-default-description"
                    onCheckedChange={(checked) => { setIsDefault(checked); setSaveStatus(null); setSaveError(null); }} />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button type="button" onClick={() => void saveStyle()} disabled={!styleName.trim() || isBusy}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                    {isSaving ? 'Guardando…' : libraryScope === 'team' ? 'Revisar y publicar' : 'Guardar estilo'}
                  </Button>
                  {dirty ? <span className="text-xs text-muted-foreground" role="status">Hay cambios sin guardar.</span> : null}
                </div>
                <div className="min-h-5" aria-live="polite">
                  {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
                  {saveStatus ? <p className="flex items-center gap-1.5 text-sm text-cw-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{saveStatus}</p> : null}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Dónde se usa: <Link className="underline underline-offset-2 hover:text-foreground" href="/contact/compose">Redactar</Link> ·{' '}
                  <Link className="underline underline-offset-2 hover:text-foreground" href="/campaigns">Campañas</Link> ·{' '}
                  <Link className="underline underline-offset-2 hover:text-foreground" href="/cowork">Cowork</Link>
                </p>
              </div>
            </fieldset>
          </div>

          <section aria-labelledby="email-preview-title" className="min-w-0 bg-muted/20 p-4 sm:p-6">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 id="email-preview-title" className="text-lg font-semibold tracking-tight text-foreground">Vista previa</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Un ejemplo con este estilo. La IA lo ajusta a cada persona al redactar.</p>
              </div>
              <div className="w-full min-w-0 sm:w-[250px] sm:shrink-0">
                {isLoadingContext ? (
                  <div className="space-y-2" aria-busy="true"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full rounded-xl" /><span className="sr-only">Cargando contactos para la vista previa</span></div>
                ) : leadOptions.length > 0 ? (
                  <div className="space-y-2">
                    <Label htmlFor="email-preview-lead">Con el contacto</Label>
                    <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                      <SelectTrigger id="email-preview-lead" className="rounded-xl bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {leadOptions.map(({ lead }) => (
                          <SelectItem key={lead.id} value={lead.id}>{lead.fullName}{lead.companyName ? ` · ${lead.companyName}` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {leadError ? 'No pudimos cargar tus contactos: usamos un ejemplo.' : 'Cuando investigues un contacto, podrás ver el correo con sus datos reales.'}
                  </p>
                )}
              </div>
            </div>

            <article aria-labelledby="preview-email-subject" aria-busy={isAdjusting} className="mt-5 min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-background shadow-sm">
              <header className="min-w-0 border-b border-border/70 px-4 py-4 sm:px-6">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-2 font-medium text-foreground"><Mail className="h-4 w-4 text-primary" aria-hidden="true" />Correo nuevo</span>
                  <span>{toneLabel(profile.tone)} · {lengthLabel(profile.length)}</span>
                </div>
                <h3 id="preview-email-subject" className="mt-4 break-words text-lg font-semibold leading-7 tracking-tight text-foreground">{preview.subject || 'Sin asunto'}</h3>
                <dl className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground sm:text-sm">
                  <div className="flex min-w-0 gap-2"><dt className="w-9 shrink-0">De</dt><dd className="min-w-0 truncate text-foreground">{sender.name} &lt;{sender.email}&gt;</dd></div>
                  <div className="flex min-w-0 gap-2"><dt className="w-9 shrink-0">Para</dt><dd className="min-w-0 truncate text-foreground">{previewLead.fullName} &lt;{previewLead.email}&gt;</dd></div>
                </dl>
              </header>
              <div className="min-w-0 space-y-4 px-4 py-6 sm:px-6">
                <div className="space-y-4 break-words text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]">
                  {(preview.body || 'El correo aparecerá aquí.').split(/\n\n+/).map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 24)}`} className="whitespace-pre-line">{paragraph}</p>
                  ))}
                </div>
                {signatureHtml && signatureOn ? (
                  // Light surface on purpose: the signature is shown as the recipient's email client draws it.
                  <div role="group" aria-label="Tu firma" className="overflow-x-auto rounded-lg bg-white p-3 ring-1 ring-border/60">
                    <div dangerouslySetInnerHTML={{ __html: signatureHtml }} />
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                    {signatureHtml ? 'Tu firma está apagada: no se agrega al enviar.' : 'Aún no tienes firma.'}{' '}
                    {onOpenSignature ? <button type="button" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpenSignature}>Ir a «Firma»</button> : null}
                  </p>
                )}
              </div>
              <footer className="break-words border-t border-border/70 bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
                {selectedLeadOption ? `Con la investigación de ${previewLead.companyName}.` : 'Con datos de ejemplo.'}{' '}
                Remitente: {sender.name} · {sender.company}.{profileError ? ' Completa tu perfil para usar tus datos reales.' : ''}
              </footer>
            </article>
          </section>
        </div>
      </section>
    </div>
  );
}
