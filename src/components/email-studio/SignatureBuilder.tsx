'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, Mail, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  buildSignatureHtml, buildSignatureText, EMPTY_SIGNATURE_FIELDS, SIGNATURE_DESIGNS, signatureProblem,
  type SignatureDesign, type SignatureFields,
} from '@/lib/email-studio/signature-builder';
import { emailSignatureStorage, type EmailChannel, type SignatureConfig } from '@/lib/email-signature-storage';
import { profileService } from '@/lib/services/profile-service';
import { buildSenderInfo } from '@/lib/signature-placeholders';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/**
 * «Firma» in «Firmas y estilo» (Plan 11, PR 3b): fill in a few fields, pick a design and see it at the end of a real-looking
 * email. One signature for every account by default; it goes out with every email the app sends (PR 3a), before the
 * unsubscribe line, while «Usar al enviar» is on. Uploading a ready-made image is still one of the designs.
 */
const CHANNELS: Array<{ id: EmailChannel; label: string }> = [{ id: 'gmail', label: 'Gmail' }, { id: 'outlook', label: 'Outlook' }];
type Draft = { design: SignatureDesign; fields: SignatureFields };

const imageFromHtml = (html: string | undefined) => html?.match(/<img[^>]+src="(https:[^"]+)"/i)?.[1] || '';

/** What a saved signature looked like, for the form: the builder data, or an older image-only signature. */
function draftFrom(config: SignatureConfig | null, fallback: SignatureFields): Draft | null {
  if (!config) return null;
  if (config.builder?.fields) return { design: config.builder.design, fields: { ...EMPTY_SIGNATURE_FIELDS, ...config.builder.fields } };
  const image = imageFromHtml(config.html);
  return image ? { design: 'imagen', fields: { ...fallback, imageUrl: image } } : null;
}

export default function SignatureBuilder({ onSaved }: { onSaved?: () => void } = {}) {
  const { toast } = useToast();
  const baseId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [configs, setConfigs] = useState<Record<EmailChannel, SignatureConfig | null>>({ gmail: null, outlook: null });
  const [profileFields, setProfileFields] = useState<SignatureFields>(EMPTY_SIGNATURE_FIELDS);
  const [sameForAll, setSameForAll] = useState(true);
  const [channel, setChannel] = useState<EmailChannel>('gmail');
  const [design, setDesign] = useState<SignatureDesign>('clasica');
  const [fields, setFields] = useState<SignatureFields>(EMPTY_SIGNATURE_FIELDS);
  const [enabled, setEnabled] = useState(true);
  const [separator, setSeparator] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([emailSignatureStorage.get('gmail'), emailSignatureStorage.get('outlook'), profileService.getCurrentProfile()])
      .then(([gmail, outlook, profile]) => {
        if (!active) return;
        const sender = buildSenderInfo(profile);
        const fromProfile: SignatureFields = {
          ...EMPTY_SIGNATURE_FIELDS, name: sender.name || '', title: sender.title || '', company: sender.company || '',
          phone: sender.phone || '', website: sender.website || '',
        };
        setProfileFields(fromProfile);
        setConfigs({ gmail, outlook });
        const first = draftFrom(gmail, fromProfile) || draftFrom(outlook, fromProfile);
        setDesign(first?.design || 'clasica');
        setFields(first?.fields || fromProfile);
        setEnabled((gmail || outlook) ? Boolean(gmail?.enabled || outlook?.enabled) : true);
        setSeparator((gmail || outlook)?.separatorPlaintext !== false);
        // Two accounts that sign differently keep being edited one by one.
        setSameForAll(!(gmail?.html && outlook?.html && gmail.html !== outlook.html));
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const html = useMemo(() => buildSignatureHtml(fields, design), [fields, design]);
  const update = (patch: Partial<SignatureFields>) => {
    setFields(current => ({ ...current, ...patch }));
    setStatus(null);
    setProblem(null);
  };

  function chooseChannel(next: EmailChannel) {
    setChannel(next);
    const draft = draftFrom(configs[next], profileFields);
    if (draft) { setDesign(draft.design); setFields(draft.fields); }
    setEnabled(configs[next]?.enabled ?? true);
    setStatus(null);
    setProblem(null);
  }

  async function upload(file: File) {
    setProblem(null);
    if (!/^image\/(png|jpeg)$/i.test(file.type)) { setProblem('Sube una imagen PNG o JPG.'); return; }
    if (file.size > 2 * 1024 * 1024) { setProblem('La imagen pasa de 2 MB. Usa una más liviana.'); return; }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
      const key = `signatures/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
      const { error } = await supabase.storage.from('public').upload(key, file, { cacheControl: '3600', upsert: false });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('public').getPublicUrl(key);
      update({ imageUrl: publicUrl });
    } catch (error) {
      setProblem(error instanceof Error && error.message.includes('sesión') ? error.message : 'No pudimos subir la imagen. Inténtalo de nuevo.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    const issue = signatureProblem(fields, design);
    if (issue) { setProblem(issue); return; }
    setSaving(true);
    setProblem(null);
    try {
      const base = {
        enabled, html, text: buildSignatureText(fields, design), separatorPlaintext: separator,
        updatedAt: new Date().toISOString(), builder: { design, fields },
      };
      const targets: EmailChannel[] = sameForAll ? ['gmail', 'outlook'] : [channel];
      const saved = targets.map(target => ({ ...base, channel: target }) as SignatureConfig);
      await emailSignatureStorage.saveAll(saved);
      setConfigs(current => ({ ...current, ...Object.fromEntries(saved.map(config => [config.channel, config])) }));
      const where = sameForAll ? 'Gmail y Outlook' : CHANNELS.find(item => item.id === channel)?.label;
      setStatus(enabled ? `Firma guardada. Va en tus correos de ${where}.` : 'Firma guardada. No se usará hasta que actives «Usar al enviar».');
      toast({ title: 'Firma guardada', description: enabled ? 'Se agregará al final de cada correo que envíes.' : 'Está apagada: no se agrega a tus correos.' });
      onSaved?.();
    } catch {
      setProblem('No pudimos guardar la firma. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2" aria-busy="true">
        <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        <Skeleton className="h-72 w-full rounded-2xl" />
        <span className="sr-only">Cargando tu firma</span>
      </div>
    );
  }

  const field = (id: keyof SignatureFields, label: string, props: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${baseId}-${id}`}>{label}</Label>
      <Input id={`${baseId}-${id}`} value={String(fields[id] ?? '')} onChange={event => update({ [id]: event.target.value })} {...props} />
    </div>
  );
  const needsImage = design === 'con-logo' || design === 'imagen';

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby={`${baseId}-form`} className="min-w-0 space-y-6">
        <h2 id={`${baseId}-form`} className="sr-only">Arma tu firma</h2>
        {loadError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>No pudimos cargar tu firma guardada. Puedes armar una nueva; al guardar reemplaza la anterior.</AlertDescription>
          </Alert>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Diseño</legend>
          <RadioGroup value={design} onValueChange={value => { setDesign(value as SignatureDesign); setStatus(null); setProblem(null); }}
            className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            {SIGNATURE_DESIGNS.map(option => (
              <Label key={option.id} htmlFor={`${baseId}-design-${option.id}`}
                className={cn('flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background p-3 transition-colors hover:bg-muted/40',
                  design === option.id && 'border-primary bg-primary/5')}>
                <RadioGroupItem id={`${baseId}-design-${option.id}`} value={option.id} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className="block text-xs font-normal leading-5 text-foreground/75">{option.description}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        {design !== 'imagen' ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">Tus datos</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {field('name', 'Nombre', { autoComplete: 'name', maxLength: 120 })}
              {field('title', 'Cargo', { autoComplete: 'organization-title', maxLength: 120 })}
              {field('company', 'Empresa', { autoComplete: 'organization', maxLength: 120 })}
              {field('phone', 'Teléfono', { autoComplete: 'tel', inputMode: 'tel', maxLength: 40 })}
              {field('website', 'Sitio web', { placeholder: 'empresa.cl', maxLength: 200 })}
              {field('linkedin', 'LinkedIn', { placeholder: 'https://www.linkedin.com/in/…', maxLength: 300 })}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Vienen de tu perfil; cámbialos aquí si tu firma dice otra cosa.</p>
          </fieldset>
        ) : null}

        {needsImage ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{design === 'imagen' ? 'Imagen de tu firma' : 'Logo o foto'}</p>
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" tabIndex={-1} aria-hidden="true"
                onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} aria-busy={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                {uploading ? 'Subiendo…' : fields.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
              </Button>
              <span className="text-xs text-muted-foreground">PNG o JPG, hasta 2 MB.</span>
            </div>
          </div>
        ) : null}

        <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor={`${baseId}-enabled`}>Usar al enviar</Label>
              <p className="text-xs leading-5 text-muted-foreground">Se agrega sola al final de cada correo, antes del enlace para darse de baja.</p>
            </div>
            <Switch id={`${baseId}-enabled`} checked={enabled} onCheckedChange={checked => { setEnabled(checked); setStatus(null); }} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor={`${baseId}-same`}>Una firma para todas tus cuentas</Label>
              <p className="text-xs leading-5 text-muted-foreground">La misma en Gmail y Outlook. Apágalo para que cada cuenta firme distinto.</p>
            </div>
            <Switch id={`${baseId}-same`} checked={sameForAll} onCheckedChange={checked => { setSameForAll(checked); setStatus(null); }} />
          </div>
          {!sameForAll ? (
            <div className="grid h-9 grid-cols-2 rounded-lg border border-border/60 bg-muted/60 p-1" role="group" aria-label="Cuenta que estás editando">
              {CHANNELS.map(item => (
                <button key={item.id} type="button" aria-pressed={channel === item.id} onClick={() => chooseChannel(item.id)}
                  className={cn('rounded-md text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    channel === item.id ? 'bg-background text-foreground shadow-sm' : 'text-foreground/70 hover:text-foreground')}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor={`${baseId}-separator`}>Separar con «-- » en texto plano</Label>
              <p className="text-xs leading-5 text-muted-foreground">Algunos programas de correo usan esa línea para reconocer la firma.</p>
            </div>
            <Switch id={`${baseId}-separator`} checked={separator} onCheckedChange={checked => { setSeparator(checked); setStatus(null); }} />
          </div>
        </div>

        {/* Always in view while editing: the form is long and «Guardar firma» took scrolling to reach. */}
        <div className="sticky bottom-0 z-10 space-y-2 border-t border-border/60 bg-background pb-3 pt-3">
          <Button type="button" onClick={() => void save()} disabled={saving || uploading} aria-busy={saving} className="w-full sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Guardando…' : 'Guardar firma'}
          </Button>
          <div aria-live="polite" className="min-h-5 text-sm">
            {problem ? <p className="flex items-center gap-1.5 text-destructive"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{problem}</p> : null}
            {status ? <p className="flex items-center gap-1.5 text-cw-success"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{status}</p> : null}
          </div>
        </div>
      </section>

      <section aria-labelledby={`${baseId}-preview`} className="min-w-0">
        <h2 id={`${baseId}-preview`} className="text-sm font-medium text-foreground">Así se ve en un correo</h2>
        <article className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
          <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <Mail className="h-4 w-4 text-primary" aria-hidden="true" /> Correo de ejemplo
          </header>
          <div className="space-y-3 px-4 py-5 text-sm leading-6 text-foreground sm:px-6">
            <p>Hola María,</p>
            <p>Te escribo porque vi que tu equipo está creciendo y quizás les sirva lo que hacemos.</p>
            <p>¿Te parece conversarlo 15 minutos esta semana?</p>
            <p>Saludos,</p>
            {html ? (
              // Light surface on purpose: the signature is shown as the recipient's email client draws it.
              <div role="group" aria-label="Tu firma" className="overflow-x-auto rounded-lg bg-white p-3 ring-1 ring-border/60">
                <div dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                {signatureProblem(fields, design) || 'Tu firma aparecerá aquí.'}
              </p>
            )}
            <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">Si no quieres recibir más correos, puedes darte de baja aquí.</p>
          </div>
        </article>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Se agrega en todo lo que envías desde la app: Redactar, campañas, seguimientos automáticos, Cowork y respuestas en el hilo.
          {enabled ? '' : ' Ahora está apagada.'}
        </p>
      </section>
    </div>
  );
}
