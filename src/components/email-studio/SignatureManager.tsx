'use client';

import React, { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { CheckCircle2, ImagePlus, Loader2 } from 'lucide-react';
import {
  emailSignatureStorage,
  EmailChannel,
  SignatureConfig,
} from '@/lib/email-signature-storage';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Props = { channel: EmailChannel };

// --- helpers ---
function onlyImageHTML(url: string, width: number, altText: string) {
  return `<!-- Firma (solo imagen) -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;border-collapse:collapse;">
  <tr>
    <td style="padding:0;">
      <img src="${url}" width="${width}" alt="${altText.replace(/"/g, '')}" style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;height:auto;">
    </td>
  </tr>
</table>`;
}
function combinedHTML(
  url: string,
  width: number,
  altText: string,
  nameText?: string,
  titleText?: string,
  websiteText?: string,
  phoneText?: string
) {
  const contactRow =
    (websiteText && websiteText !== 'https://') || phoneText
      ? `<tr>
  <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#475467;">
    ${websiteText && websiteText !== 'https://' ? `<a href="${websiteText}" style="color:#1570EF;text-decoration:none;">${websiteText}</a>` : ''}${websiteText && phoneText ? ' · ' : ''
      }${phoneText || ''}
  </td>
</tr>`
      : '';
  const nameRow =
    nameText || titleText
      ? `<tr>
  <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#101828;">
    ${nameText ? `<strong>${nameText}</strong>` : ''}${titleText ? `${nameText ? '<br>' : ''}${titleText}` : ''}
  </td>
</tr>`
      : '';

  return `<!-- Firma (imagen + datos) -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;border-collapse:collapse;">
  <tr>
    <td style="padding:0 0 8px 0;">
      <img src="${url}" width="${width}" alt="${altText.replace(/"/g, '')}" style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;height:auto;">
    </td>
  </tr>
  ${nameRow}
  ${contactRow}
</table>`;
}
// --- component ---
export default function SignatureManager({ channel }: Props) {
  const channelName = channel === 'gmail' ? 'Gmail' : 'Outlook';
  const baseId = `signature-${channel}`;
  // Estado base
  const [enabled, setEnabled] = useState(true);
  const [separatorPlaintext, setSeparatorPlaintext] = useState(true);

  // Imagen
  const [logoUrl, setLogoUrl] = useState('');             // URL pública
  const [localPreviewUrl, setLocalPreviewUrl] = useState(''); // URL.createObjectURL(file)
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Datos opcionales
  const [addText, setAddText] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [website, setWebsite] = useState('https://');
  const [phone, setPhone] = useState('');

  // Visual (ancho real a usar en el envío)
  const [imgWidth, setImgWidth] = useState(260);
  // Ancho fijo en la vista previa, para que no crezca el panel
  const PREVIEW_IMG_WIDTH = 320;
  const [alt, setAlt] = useState('Firma');

  // Meta
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [advancedSavedAt, setAdvancedSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cargar firma previa (si existe)
  useEffect(() => {
    (async () => {
      const cfg = await emailSignatureStorage.get(channel);
      if (cfg) {
        setEnabled(!!cfg.enabled);
        setSeparatorPlaintext(cfg.separatorPlaintext !== false);
        const match = cfg.html?.match(/<img[^>]+src="([^"]+)"/i);
        if (match?.[1]) setLogoUrl(match[1]);
        const w = cfg.html?.match(/<img[^>]+width="(\d+)"/i)?.[1];
        if (w) setImgWidth(Number(w));
        setSavedAt(cfg.updatedAt || null);
      }
    })();
  }, [channel]);

  // Construir vista previa (prioriza la URL local si existe para feedback inmediato)
  const previewHTML = useMemo(() => {
    const src = localPreviewUrl || logoUrl;
    if (!src) return '';
    const base = addText
      ? combinedHTML(src, PREVIEW_IMG_WIDTH, alt || 'Firma', name || '', title || '', website || '', phone || '')
      : onlyImageHTML(src, PREVIEW_IMG_WIDTH, alt || 'Firma');
    return DOMPurify.sanitize(base, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'style'],
      FORBID_ATTR: ['onerror', 'onload'],
    }) as string;
  }, [localPreviewUrl, logoUrl,
    alt, addText, name, title, website, phone]);

  function validateFile(file: File) {
    if (!/^image\/(png|jpeg)$/i.test(file.type)) {
      return 'Sube una imagen PNG o JPG.';
    }
    if (file.size > 5 * 1024 * 1024) {
      return 'La imagen supera los 5 MB. Usa una más liviana.';
    }
    return null;
  }

  // Sube archivo y guarda al terminar: subir es guardar
  async function handleUpload(file: File) {
    setError(null);
    if (!file) return;
    const validation = validateFile(file);
    if (validation) { setError(validation); return; }

    // Vista previa inmediata (no depende de la subida)
    const tmpUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(tmpUrl);

    try {
      setUploading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');

      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      const key = `signatures/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('public') // Asumiendo bucket 'public'
        .upload(key, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('public')
        .getPublicUrl(key);

      setLogoUrl(publicUrl);

      // Autoguardar firma (solo-imagen por defecto)
      const html = addText
        ? combinedHTML(publicUrl, imgWidth, alt || 'Firma', name || '', title || '', website || '', phone || '')
        : onlyImageHTML(publicUrl, imgWidth, alt || 'Firma');

      const cfg: SignatureConfig = {
        channel,
        enabled,
        html,
        text: addText
          ? [name || '', title || '', website && website !== 'https://' ? website : '', phone || '']
            .filter(Boolean)
            .join('\n')
          : '',
        separatorPlaintext,
        updatedAt: new Date().toISOString(),
      };
      await emailSignatureStorage.save(cfg);
      setSavedAt(cfg.updatedAt);
      setAdvancedSavedAt(null);

      // Al tener URL definitiva, usamos esa también en la preview
      setLocalPreviewUrl(''); // deja de usar objectURL
    } catch (e: any) {
      console.error('[signature/upload]', e);
      setError(e?.message || 'No pudimos subir la imagen. Inténtalo nuevamente.');
    } finally {
      setUploading(false);
    }
  }

  async function toggleEnabled(next: boolean) {
    setEnabled(next);
    setError(null);
    try {
      const current = await emailSignatureStorage.get(channel);
      if (current) {
        const cfg = { ...current, enabled: next, updatedAt: new Date().toISOString() };
        await emailSignatureStorage.save(cfg);
        setSavedAt(cfg.updatedAt);
      } else {
        await emailSignatureStorage.enable(channel, next);
      }
    } catch {
      setEnabled(!next);
      setError('No pudimos guardar el cambio. Inténtalo nuevamente.');
    }
  }

  // Guardado manual de los ajustes avanzados
  async function handleSaveAdvanced() {
    setError(null);
    const src = logoUrl; // no permitimos guardar si solo hay objectURL local
    if (!src || !/^https:\/\//i.test(src)) {
      setError('Primero sube la imagen de tu firma.');
      return;
    }
    const html = addText
      ? combinedHTML(src, imgWidth, alt || 'Firma', name || '', title || '', website || '', phone || '')
      : onlyImageHTML(src, imgWidth, alt || 'Firma');

    const cfg: SignatureConfig = {
      channel,
      enabled,
      html,
      text: addText
        ? [name || '', title || '', website && website !== 'https://' ? website : '', phone || '']
          .filter(Boolean)
          .join('\n')
        : '',
      separatorPlaintext,
      updatedAt: new Date().toISOString(),
    };
    try {
      await emailSignatureStorage.save(cfg);
      setSavedAt(cfg.updatedAt);
      setAdvancedSavedAt(cfg.updatedAt);
    } catch {
      setError('No pudimos guardar los ajustes. Inténtalo nuevamente.');
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight">Firma para {channelName}</h3>
          {savedAt
            ? <p role="status" className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Guardada y lista para tus envíos</p>
            : <p className="mt-1 text-xs leading-5 text-muted-foreground">Sube tu imagen una vez y queda lista.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label htmlFor={`${baseId}-enabled`} className="text-xs font-normal text-muted-foreground">Usar al enviar</Label>
          <Switch id={`${baseId}-enabled`} checked={enabled} onCheckedChange={(checked) => void toggleEnabled(checked)} disabled={uploading} />
        </div>
      </div>

      <label
        htmlFor={`${baseId}-file`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault(); setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void handleUpload(file);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-ring ${dragging ? 'border-primary bg-primary/5' : 'border-border/70 bg-muted/20 hover:border-primary/50 hover:bg-muted/35'}`}
      >
        <input
          id={`${baseId}-file`}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            event.target.value = '';
            if (file) void handleUpload(file);
          }}
        />
        {uploading
          ? <><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" /><span role="status" className="text-sm text-muted-foreground">Subiendo tu firma…</span></>
          : <><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10"><ImagePlus className="h-5 w-5 text-primary" aria-hidden="true" /></span>
            <span className="text-sm font-medium">{logoUrl || localPreviewUrl ? 'Cambiar imagen de firma' : 'Sube tu firma'}</span>
            <span className="text-xs leading-5 text-muted-foreground">Arrastra la imagen o haz clic para elegirla · PNG o JPG hasta 5 MB</span></>}
      </label>

      {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}

      <div className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-background">
        <p className="border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">Vista previa · así se verá en tus correos</p>
        <div className="space-y-3 px-4 py-4">
          <div className="space-y-1 text-sm leading-6 text-muted-foreground" aria-hidden="true">
            <p>Hola Ana, te comparto la propuesta…</p>
            <p>Saludos,</p>
          </div>
          {previewHTML
            ? <div className="[&_img]:max-w-full [&_img]:rounded-lg [&_table]:!w-auto [&_table]:max-w-full" dangerouslySetInnerHTML={{ __html: previewHTML }} />
            : <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">Aún no tienes firma para {channelName}.</div>}
        </div>
      </div>

      <details className="group rounded-2xl border border-border/60 bg-muted/20">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">Opciones avanzadas</summary>
        <div className="space-y-4 border-t border-border/60 px-4 py-4">
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-url`}>URL de la imagen</Label>
            <Input id={`${baseId}-url`} inputMode="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://…/firma.png" className="h-11 rounded-xl bg-background/70" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${baseId}-width`}>Ancho en el correo (px)</Label>
              <Input id={`${baseId}-width`} type="number" min={100} max={600} step={10} value={imgWidth} onChange={(event) => setImgWidth(Number(event.target.value) || 260)} className="h-11 rounded-xl bg-background/70" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${baseId}-alt`}>Texto alternativo</Label>
              <Input id={`${baseId}-alt`} value={alt} onChange={(event) => setAlt(event.target.value)} className="h-11 rounded-xl bg-background/70" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id={`${baseId}-text`} checked={addText} onCheckedChange={setAddText} />
            <Label htmlFor={`${baseId}-text`} className="font-normal">Añadir nombre, cargo y contacto debajo</Label>
          </div>
          {addText && (
            <div className="grid gap-3">
              <div className="space-y-2"><Label htmlFor={`${baseId}-name`}>Nombre</Label><Input id={`${baseId}-name`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" className="h-11 rounded-xl bg-background/70" /></div>
              <div className="space-y-2"><Label htmlFor={`${baseId}-title`}>Cargo y empresa</Label><Input id={`${baseId}-title`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Cargo · Empresa" className="h-11 rounded-xl bg-background/70" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor={`${baseId}-website`}>Sitio web</Label><Input id={`${baseId}-website`} inputMode="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://tu-sitio.com" className="h-11 rounded-xl bg-background/70" /></div>
                <div className="space-y-2"><Label htmlFor={`${baseId}-phone`}>Teléfono</Label><Input id={`${baseId}-phone`} inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+56 9 …" className="h-11 rounded-xl bg-background/70" /></div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch id={`${baseId}-separator`} checked={separatorPlaintext} onCheckedChange={setSeparatorPlaintext} />
            <Label htmlFor={`${baseId}-separator`} className="font-normal">Separador en correos de solo texto</Label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled={uploading} onClick={() => void handleSaveAdvanced()}>Guardar ajustes avanzados</Button>
            {advancedSavedAt && <span role="status" className="text-xs text-muted-foreground">Ajustes guardados</span>}
          </div>
        </div>
      </details>
    </div>
  );
}
