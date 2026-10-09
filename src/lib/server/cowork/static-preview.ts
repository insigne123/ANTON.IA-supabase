import { createHash } from 'node:crypto';
import type { CoworkPublishedFile } from '@/lib/cowork/published-files';

export class CoworkPreviewError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}
const MIME: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript' };
const MAX_BYTES = 10 * 1024 * 1024;
/** Resolve only the named outputs of one confirmed build. No URLs, directories, uploads or network fetches. */
export function coworkPreviewAssetName(reference: string): string | null {
  if (/^(?:data:|blob:)/i.test(reference)) return null;
  let name: string;
  try { name = decodeURIComponent(reference.trim().replace(/^\.\//, '')); } catch { throw new CoworkPreviewError('La vista contiene una referencia de archivo inválida.'); }
  if (!name || /[/\\\0?#:]/.test(name) || name.startsWith('.') || name.length > 120) {
    throw new CoworkPreviewError('La vista necesita un recurso externo o una ruta que no está en los archivos publicados. Usa archivos locales del mismo trabajo.');
  }
  return name;
}

export async function buildCoworkStaticPreview(html: Buffer, files: CoworkPublishedFile[], read: (file: CoworkPublishedFile) => Promise<Buffer>) {
  if (files.length > 16 || html.length > MAX_BYTES || new Set(files.map(file => file.name)).size !== files.length) throw new CoworkPreviewError('La vista supera el límite de archivos.');
  const { JSDOM } = await import('jsdom');
  // Default JSDOM does not execute scripts or load resources. Generated content never runs on the server.
  const dom = new JSDOM(html.toString('utf8'));
  const document = dom.window.document;
  const cached = new Map<string, Buffer>();
  let total = html.length;
  const asset = async (reference: string, extensions: string[]) => {
    const name = coworkPreviewAssetName(reference);
    if (name === null) return { name: null, bytes: null, mime: null };
    const ext = name.split('.').pop()!.toLowerCase(), file = files.find(file => file.name === name);
    if (!file?.sha256 || !extensions.includes(ext)) throw new CoworkPreviewError(`Falta la revisión publicada de ${name}. Conserva ese archivo junto a la miniapp.`);
    let bytes = cached.get(name);
    if (!bytes) {
      bytes = await read(file); total += bytes.length;
      if (!bytes.length || total > MAX_BYTES || file.size !== bytes.length) throw new CoworkPreviewError('Los recursos de la vista superan el límite o cambiaron de tamaño.');
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new CoworkPreviewError('Un recurso no coincide con la versión publicada.', 409);
      cached.set(name, bytes);
    }
    return { name, bytes, mime: MIME[ext] };
  };
  const dataUrl = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString('base64')}`;
  const css = async (text: string) => {
    if (/@import\b/i.test(text)) throw new CoworkPreviewError('La vista necesita CSS autocontenido, sin imports externos.');
    const references = [...text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
    for (const match of references) {
      const reference = (match[1] ?? match[2] ?? match[3]).trim();
      if (reference.startsWith('#')) continue; // Local SVG fragment, no file access.
      const file = await asset(reference, ['png', 'svg']);
      if (file.bytes && file.mime) text = text.replace(match[0], `url("${dataUrl(file.bytes, file.mime)}")`);
    }
    return text;
  };
  try {
    document.querySelectorAll('base, meta[http-equiv], link[rel="preload"], link[rel="preconnect"], link[rel="modulepreload"]').forEach(node => node.remove());
    for (const node of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
      const file = await asset(node.getAttribute('href') || '', ['css']);
      if (!file.bytes) throw new CoworkPreviewError('La hoja de estilo debe ser un archivo local publicado.');
      const style = document.createElement('style'); style.textContent = (await css(file.bytes.toString('utf8'))).replace(/<\/style/gi, '<\\/style');
      node.replaceWith(style);
    }
    for (const node of Array.from(document.querySelectorAll<HTMLStyleElement>('style'))) node.textContent = (await css(node.textContent || '')).replace(/<\/style/gi, '<\\/style');
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('[style]'))) node.setAttribute('style', await css(node.getAttribute('style') || ''));
    for (const node of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) {
      const file = await asset(node.getAttribute('src') || '', ['js', 'mjs']);
      if (!file.bytes) throw new CoworkPreviewError('El script debe ser un archivo local publicado.');
      if (node.type === 'module') throw new CoworkPreviewError('Compila los módulos en un script autocontenido antes de abrir esta vista.');
      node.removeAttribute('src'); node.removeAttribute('integrity'); node.removeAttribute('crossorigin');
      // Escaping the raw-text closing delimiter prevents a file from breaking out of its script element.
      node.textContent = file.bytes.toString('utf8').replace(/<\/script/gi, '<\\/script');
    }
    for (const node of Array.from(document.querySelectorAll<HTMLImageElement>('img[src]'))) {
      const file = await asset(node.getAttribute('src') || '', ['png', 'svg']);
      if (file.bytes && file.mime) node.setAttribute('src', dataUrl(file.bytes, file.mime));
      node.removeAttribute('srcset');
    }
    if (document.querySelector('source[src],source[srcset],video[src],audio[src],iframe,object,embed')) throw new CoworkPreviewError('Este conjunto necesita una vista estática autocontenida, sin marcos ni recursos multimedia externos.');
    const serialized = dom.serialize();
    if (Buffer.byteLength(serialized) > 20 * 1024 * 1024) throw new CoworkPreviewError('La vista ensamblada supera el límite.');
    return { bytes: Buffer.from(serialized), assets: [...cached.keys()], status: 'assembled_not_semantically_verified' as const };
  } finally { dom.window.close(); }
}
