'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardPaste, Code2, FileUp, ImagePlus, Info, Loader2, Mail, RotateCcw, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  buildSignatureHtml, buildSignatureText, EMPTY_SIGNATURE_FIELDS, SIGNATURE_DESIGNS, signatureProblem,
  type SignatureDesign, type SignatureFields,
} from '@/lib/email-studio/signature-builder';
import {
  decodeSignatureFile, hasPendingImages, importSignatureHtml, placeUploadedImages, SIGNATURE_MAX_IMAGE_BYTES,
} from '@/lib/email-studio/signature-import';
import { emailSignatureStorage, type EmailChannel, type SignatureConfig } from '@/lib/email-signature-storage';
import { profileService } from '@/lib/services/profile-service';
import { buildSenderInfo } from '@/lib/signature-placeholders';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/**
 * «Firma» in «Firmas y estilo» (Plan 11, PR 3b): fill in a few fields, pick a design and see it at the end of a real-looking
 * email. One signature for every account by default; it goes out with every email the app sends (PR 3a), before the
 * unsubscribe line, while «Usar al enviar» is on. Uploading a ready-made image is still one of the designs, and «Tu firma
 * actual» keeps the signature the person already uses in Gmail or Outlook, pasted or read from its .htm file.
 */
const CHANNELS: Array<{ id: EmailChannel; label: string }> = [{ id: 'gmail', label: 'Gmail' }, { id: 'outlook', label: 'Outlook' }];
type Draft = { design: SignatureDesign; fields: SignatureFields };

const imageFromHtml = (html: string | undefined) => html?.match(/<img[^>]+src="(https:[^"]+)"/i)?.[1] || '';

/** A stored signature cleaned again before it is shown: the screen never draws markup it did not clean itself. */
const cleanStored = (html: string) => (typeof window === 'undefined' ? '' : importSignatureHtml(html, window).html);

/**
 * What a saved signature looked like, for the form: the builder data, or an older signature saved before the builder,
 * which comes back as an image or as «Tu firma actual».
 */
function draftFrom(config: SignatureConfig | null, fallback: SignatureFields): Draft | null {
  if (!config) return null;
  if (config.builder?.fields) {
    const fields = { ...EMPTY_SIGNATURE_FIELDS, ...config.builder.fields };
    return { design: config.builder.design, fields: config.builder.design === 'propia' ? { ...fields, customHtml: cleanStored(fields.customHtml) } : fields };
  }
  const image = imageFromHtml(config.html);
  const onlyImage = image && !config.html.replace(/<[^>]+>/g, '').replace(/&nbsp;|\s/g, '');
  if (onlyImage) return { design: 'imagen', fields: { ...fallback, imageUrl: image } };
  const own = config.html ? cleanStored(config.html) : '';
  return own ? { design: 'propia', fields: { ...fallback, customHtml: own } } : null;
}

/** How to copy the signature out of each program, shown next to the paste box. */
const COPY_HELP = [
  { app: 'Gmail', how: 'Configuración › Ver todos los ajustes › Firma: selecciona tu firma completa y cópiala.' },
  { app: 'Outlook', how: 'Configuración › Correo › Redactar y responder (o Archivo › Opciones › Correo › Firmas): selecciónala y cópiala. También puedes subir el archivo .htm de tu carpeta de firmas.' },
];

export default function SignatureBuilder({ onSaved }: { onSaved?: () => void } = {}) {
  const { toast } = useToast();
  const baseId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const htmlFileRef = useRef<HTMLInputElement>(null);
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
  const [importing, setImporting] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
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

  /** An image of the signature, uploaded to the public storage the email reads it from. */
  async function storeImage(file: Blob, type: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    const extension = type === 'image/png' ? 'png' : type === 'image/gif' ? 'gif' : 'jpg';
    const key = `signatures/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const { error } = await supabase.storage.from('public').upload(key, file, { cacheControl: '3600', upsert: false, contentType: type });
    if (error) throw error;
    return supabase.storage.from('public').getPublicUrl(key).data.publicUrl;
  }

  async function upload(file: File) {
    setProblem(null);
    if (!/^image\/(png|jpeg)$/i.test(file.type)) { setProblem('Sube una imagen PNG o JPG.'); return; }
    if (file.size > 2 * 1024 * 1024) { setProblem('La imagen pasa de 2 MB. Usa una más liviana.'); return; }
    setUploading(true);
    try {
      update({ imageUrl: await storeImage(file, file.type) });
    } catch (error) {
      setProblem(error instanceof Error && error.message.includes('sesión') ? error.message : 'No pudimos subir la imagen. Inténtalo de nuevo.');
    } finally {
      setUploading(false);
    }
  }

  /**
   * «Tu firma actual»: what was pasted, typed as code or read from a file, cleaned, with its embedded images uploaded. An
   * image that lives on the person's computer cannot reach anyone, so the screen says how many were left out.
   */
  async function importSignature(raw: string, from: 'paste' | 'code' | 'file') {
    setProblem(null);
    setStatus(null);
    setNotes([]);
    const result = importSignatureHtml(raw, window);
    if (!result.html) {
      setProblem(from === 'file' ? 'No encontramos una firma en ese archivo. Sube el .htm de tu firma o pégala.' : 'No encontramos una firma en lo que pegaste. Cópiala completa e inténtalo de nuevo.');
      return;
    }
    if (result.tooLong) {
      setProblem('Tu firma es demasiado larga para enviarla. Pega una versión más simple o usa otro diseño.');
      return;
    }
    setImporting(true);
    try {
      const uploaded = await Promise.all(result.embedded.map(async image => {
        try {
          const blob = await (await fetch(image.dataUrl)).blob();
          return blob.size > SIGNATURE_MAX_IMAGE_BYTES ? null : await storeImage(blob, image.type);
        } catch {
          return null;
        }
      }));
      const html = placeUploadedImages(result.html, uploaded);
      const failed = uploaded.filter(url => !url).length;
      const next = [
        uploaded.length - failed ? `Subimos ${uploaded.length - failed === 1 ? 'la imagen' : `las ${uploaded.length - failed} imágenes`} de tu firma para que se vea en cada correo.` : '',
        failed ? `${failed === 1 ? 'Una imagen no se pudo subir' : `${failed} imágenes no se pudieron subir`} (más de 2 MB o sin conexión) y quedó fuera.` : '',
        result.dropped ? `${result.dropped === 1 ? 'Una imagen está' : `${result.dropped} imágenes están`} solo en tu computador y no llegaría a nadie: súbela con el diseño «Con logo» o «Imagen».` : '',
      ].filter(Boolean);
      if (hasPendingImages(html) || !html.trim()) { setProblem('No pudimos preparar tu firma. Inténtalo de nuevo.'); return; }
      update({ customHtml: html });
      setNotes(next);
      setCodeOpen(false);
      setCode('');
    } finally {
      setImporting(false);
    }
  }

  async function readSignatureFile(file: File) {
    if (!/\.(?:html?|txt)$/i.test(file.name) && !/^text\/(?:html|plain)$/i.test(file.type)) {
      setProblem('Sube el archivo .htm o .html de tu firma.');
      return;
    }
    if (file.size > 1024 * 1024) { setProblem('Ese archivo pasa de 1 MB. Sube solo el .htm de tu firma.'); return; }
    try {
      await importSignature(decodeSignatureFile(await file.arrayBuffer()), 'file');
    } catch {
      setProblem('No pudimos leer ese archivo. Pega tu firma en el recuadro.');
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
      setNotes([]);
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
  const busy = uploading || importing;

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

        {design === 'propia' ? (
          <OwnSignature baseId={baseId} hasSignature={Boolean(fields.customHtml)} importing={importing} notes={notes}
            codeOpen={codeOpen} code={code} onCode={setCode} onToggleCode={() => setCodeOpen(open => !open)}
            onImport={(raw, from) => void importSignature(raw, from)} onPickFile={() => htmlFileRef.current?.click()}
            onClear={() => { update({ customHtml: '' }); setNotes([]); }} />
        ) : null}
        <input ref={htmlFileRef} type="file" accept=".htm,.html,text/html" className="hidden" tabIndex={-1} aria-hidden="true"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readSignatureFile(file); }} />

        {design !== 'imagen' && design !== 'propia' ? (
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
          <Button type="button" onClick={() => void save()} disabled={saving || busy} aria-busy={saving} className="w-full sm:w-auto">
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
              // Light surface and dark ink on purpose: the signature is shown as the recipient's email client draws it, so a
              // pasted signature without its own colors does not take the app's light text in dark mode.
              <div role="group" aria-label="Tu firma" className="overflow-x-auto rounded-lg bg-white p-3 ring-1 ring-border/60" style={{ color: '#1f2937' }}>
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

/**
 * «Tu firma actual»: a box that only takes a paste (typing in it does nothing), the .htm file Outlook keeps, or the HTML code
 * for whoever has it. What comes in is shown in the preview, as the email will carry it.
 */
function OwnSignature({ baseId, hasSignature, importing, notes, codeOpen, code, onCode, onToggleCode, onImport, onPickFile, onClear }: {
  baseId: string; hasSignature: boolean; importing: boolean; notes: string[]; codeOpen: boolean; code: string;
  onCode: (value: string) => void; onToggleCode: () => void; onImport: (raw: string, from: 'paste' | 'code' | 'file') => void;
  onPickFile: () => void; onClear: () => void;
}) {
  const paste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    if (html || text) onImport(html || text, 'paste');
  };
  return (
    <section aria-labelledby={`${baseId}-own`} className="space-y-3">
      <div>
        <h3 id={`${baseId}-own`} className="text-sm font-medium text-foreground">{hasSignature ? 'Tu firma está lista' : 'Trae la firma que ya usas'}</h3>
        <p className="text-xs leading-5 text-muted-foreground">
          {hasSignature ? 'Revísala en la vista previa y guárdala. Para cambiarla, pega otra encima.'
            : 'Cópiala desde Gmail u Outlook y pégala abajo: se conservan el formato, los enlaces y las imágenes.'}
        </p>
      </div>
      <div
        role="textbox" aria-multiline="true" aria-label="Recuadro para pegar tu firma" aria-describedby={`${baseId}-own-help`}
        contentEditable={!importing} suppressContentEditableWarning tabIndex={0}
        onPaste={paste} onBeforeInput={event => event.preventDefault()} onDrop={event => event.preventDefault()}
        className={cn('flex min-h-24 cursor-text items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 px-4 py-5 text-center text-sm text-muted-foreground caret-transparent transition-colors',
          'hover:border-primary/50 focus-visible:border-primary focus-visible:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
      >
        {importing ? (
          <span className="flex items-center gap-2" contentEditable={false}><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Preparando tu firma…</span>
        ) : (
          <span className="flex items-center gap-2" contentEditable={false}>
            <ClipboardPaste className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Haz clic aquí y pega tu firma (Ctrl + V o ⌘ + V)
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onPickFile} disabled={importing}>
          <FileUp className="h-4 w-4" aria-hidden="true" />Subir archivo .htm
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onToggleCode} disabled={importing} aria-expanded={codeOpen} aria-controls={`${baseId}-own-code`}>
          <Code2 className="h-4 w-4" aria-hidden="true" />{codeOpen ? 'Ocultar código' : 'Pegar código HTML'}
        </Button>
        {hasSignature ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={importing} className="sm:ml-auto">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />Quitar y empezar de nuevo
          </Button>
        ) : null}
      </div>
      {codeOpen ? (
        <div id={`${baseId}-own-code`} className="space-y-2">
          <Label htmlFor={`${baseId}-own-code-input`}>Código HTML de tu firma</Label>
          <Textarea id={`${baseId}-own-code-input`} value={code} onChange={event => onCode(event.target.value)} rows={6} spellCheck={false}
            placeholder={'<table>…</table>'} className="font-mono text-xs" />
          <Button type="button" size="sm" onClick={() => onImport(code, 'code')} disabled={importing || !code.trim()}>Usar este código</Button>
        </div>
      ) : null}
      {notes.length ? (
        <ul className="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-5 text-foreground" aria-label="Lo que hicimos con tu firma">
          {notes.map(note => <li key={note} className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />{note}</li>)}
        </ul>
      ) : null}
      <div id={`${baseId}-own-help`} className="space-y-1 text-xs leading-5 text-muted-foreground">
        {COPY_HELP.map(item => <p key={item.app}><span className="font-medium text-foreground">{item.app}:</span> {item.how}</p>)}
      </div>
    </section>
  );
}
