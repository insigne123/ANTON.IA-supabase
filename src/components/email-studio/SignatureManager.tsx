'use client';

import React, { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  emailSignatureStorage,
  EmailChannel,
  SignatureConfig,
} from '@/lib/email-signature-storage';
import { supabase } from '@/lib/supabase';

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
  // Estado base
  const [enabled, setEnabled] = useState(true);
  const [separatorPlaintext, setSeparatorPlaintext] = useState(true);

  // Imagen
  const [logoUrl, setLogoUrl] = useState('');             // URL pública
  const [localPreviewUrl, setLocalPreviewUrl] = useState(''); // URL.createObjectURL(file)
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  // Datos opcionales
  const [addText, setAddText] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [website, setWebsite] = useState('https://');
  const [phone, setPhone] = useState('');

  // Visual (ancho real a usar en el envío)
  const [imgWidth, setImgWidth] = useState(260);
  // 🔒 Ancho fijo en la PREVIEW, para que no “crezca” el panel
  const PREVIEW_IMG_WIDTH = 320; // ajusta si quieres 280/300/320
  const [alt, setAlt] = useState('Firma');

  // Meta
  const [savedAt, setSavedAt] = useState<string | null>(null);
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
    // 🧪 En la vista previa no usamos `imgWidth` real para evitar que la UI se haga gigante.
    const base = addText
      ? combinedHTML(src, PREVIEW_IMG_WIDTH, alt || 'Firma', name || '', title || '', website || '', phone || '')
      : onlyImageHTML(src, PREVIEW_IMG_WIDTH, alt || 'Firma');
    return DOMPurify.sanitize(base, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'style'],
      FORBID_ATTR: ['onerror', 'onload'],
    }) as string;
  }, [localPreviewUrl, logoUrl, /* 👇 deps que afectan al HTML pero no al ancho de preview */
    alt, addText, name, title, website, phone]);

  // Sube archivo y autoguarda al terminar
  async function handleUpload(file: File) {
    setError(null);
    if (!file) return;

    // Vista previa inmediata (no depende de la subida)
    const tmpUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(tmpUrl);

    if (!/^image\/(png|jpeg)$/i.test(file.type)) {
      setError('Sube una imagen PNG o JPG (WebP no es compatible).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Archivo demasiado grande (>5 MB). Optimiza la imagen.');
      return;
    }
    try {
      setUploading(true);
      setUploadMsg('Subiendo…');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuario no autenticado');

      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      const key = `signatures/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { data, error: uploadError } = await supabase.storage
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
      setUploadMsg('Listo');

      // Autoguardar firma (solo-imagen por defecto)
      const html = addText
        ? combinedHTML(publicUrl, imgWidth, alt || 'Firma', name || '', title || '', website || '', phone || '')
        : onlyImageHTML(publicUrl, imgWidth, alt || 'Firma');

      const cfg: SignatureConfig = {
        channel,
        enabled: true,
        html,
        text: addText
          ? [name || '', title || '', website && website !== 'https://' ? website : '', phone || '']
            .filter(Boolean)
            .join('\n')
          : '',
        separatorPlaintext,
        updatedAt: new Date().toISOString(),
      };
      emailSignatureStorage.save(cfg).then(() => setSavedAt(cfg.updatedAt));
      setSavedAt(cfg.updatedAt);

      // Al tener URL definitiva, usamos esa también en la preview
      setLocalPreviewUrl(''); // deja de usar objectURL
      setTimeout(() => setUploadMsg(''), 1200);
    } catch (e: any) {
      console.error('[signature/upload]', e);
      setError(e?.message || 'Error subiendo la imagen. Verifica configuración de Supabase Storage.');
    } finally {
      setUploading(false);
    }
  }

  // Guardado manual (por si editan ancho o añaden datos luego)
  async function handleSave() {
    setError(null);
    const src = logoUrl; // no permitimos guardar si solo hay objectURL local
    if (!src || !/^https:\/\//i.test(src)) {
      setError('Primero sube la imagen para obtener una URL HTTPS pública.');
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
    emailSignatureStorage.save(cfg).then(() => setSavedAt(cfg.updatedAt));
    setSavedAt(cfg.updatedAt);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Firma para {channel === 'gmail' ? 'Gmail' : 'Outlook'}</h3>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="text-sm">Usar firma al enviar</span>
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Lado izquierdo: configuración simple en un único flujo */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Sube tu imagen (PNG/JPG)</label>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) void handleUpload(f);
              }}
            />
            {(uploading || uploadMsg) && (
              <span className="text-xs text-muted-foreground">{uploadMsg || 'Procesando…'}</span>
            )}
          </div>

          <label className="text-sm font-medium">o pega una URL HTTPS</label>
          <input
            className="w-full rounded-lg border p-2 text-sm"
            placeholder="https://…/firma.png"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Ancho (px)</label>
              <input
                type="number"
                min={100}
                max={600}
                step={10}
                className="w-full rounded-lg border p-2 text-sm"
                value={imgWidth}
                onChange={(e) => setImgWidth(Number(e.target.value || 260))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Texto ALT</label>
              <input
                className="w-full rounded-lg border p-2 text-sm"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={addText}
              onChange={(e) => setAddText(e.target.checked)}
            />
            <span className="text-sm">Añadir datos de texto (nombre, cargo, etc.)</span>
          </label>

          {addText && (
            <div className="space-y-2">
              <input
                className="w-full rounded-lg border p-2 text-sm"
                placeholder="Tu Nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="w-full rounded-lg border p-2 text-sm"
                placeholder="Cargo · Empresa"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <input
                className="w-full rounded-lg border p-2 text-sm"
                placeholder="https://tu-sitio.com/"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
              <input
                className="w-full rounded-lg border p-2 text-sm"
                placeholder="+56 9 …"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={separatorPlaintext}
                onChange={(e) => setSeparatorPlaintext(e.target.checked)}
              />
              <span className="text-sm">Añadir separador “-- ” en texto plano</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={uploading}
              className="px-3 py-2 rounded-lg border hover:bg-accent disabled:opacity-60"
            >
              Guardar firma
            </button>
            {savedAt && (
              <span className="text-xs text-muted-foreground self-center">
                Guardado: {new Date(savedAt).toLocaleString()}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Recomendado: PNG/JPG &lt; 100 kB. Evita .webp y data URI. La imagen debe ser accesible por HTTPS.
          </p>
        </div>

        {/* Lado derecho: vista previa */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Vista previa</label>
            <span className="text-xs text-muted-foreground">No escala real</span>
          </div>
          {/* 🧱 Contenedor con tamaño estable */}
          <div
            className="rounded-lg border p-4 bg-background"
            style={{ minHeight: 160, maxHeight: 280, overflow: 'auto' }}
          >
            {/* eslint-disable-next-line react/no-danger */}
            <div
              className="signature-preview-area"
              dangerouslySetInnerHTML={{ __html: previewHTML || '<em>(Sin contenido)</em>' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
