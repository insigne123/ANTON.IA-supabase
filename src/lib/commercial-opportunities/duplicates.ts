// «Estas bases ya están en…» (2 Nov 2026): the same bases loaded twice. In October one person loaded the same tender four times, each
// copy with the same seven documents, because the report of the first ones had failed; each copy paid its reading again and the list
// showed four opportunities for one tender. The documents' fingerprints (SHA-256, opportunity_documents.sha256) say it before saving.
// Pure: the page and the route share it.
import { z } from 'zod';

/** What a match says: whose opportunity, when it was loaded and how many of the files it has; the title only to who may open it. */
export type DuplicateMatch = { id: string; title: string | null; createdAt: string; matched: number; readable: boolean };

/** Up to 60 files at once, as the form takes them; each a SHA-256 in hexadecimal. */
export const duplicateQuerySchema = z.object({ hashes: z.array(z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/)).min(1).max(60) }).strict();

/** The fingerprint of a file as the server keeps it (workspace-documents.ts): SHA-256 of its bytes, in hexadecimal. */
export async function fileFingerprint(file: Blob, subtle: SubtleCrypto = globalThis.crypto.subtle) {
  const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const day = (at: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return `${Number(parts.day)} de ${MONTHS[Number(parts.month) - 1]}`;
};

/**
 * The line the form shows over the files, or null: the opportunity with most of them first. «Todas» when it has every file chosen,
 * «N de los M» otherwise; one the person cannot open is named by its date only, and they ask an administrator for it.
 */
export function duplicateNotice(matches: readonly DuplicateMatch[], chosen: number): { text: string; open: DuplicateMatch | null } | null {
  const best = [...matches].sort((a, b) => b.matched - a.matched || b.createdAt.localeCompare(a.createdAt))[0];
  if (!best || best.matched < 1 || chosen < 1) return null;
  const how = best.matched >= chosen ? (chosen === 1 ? 'Este documento ya está' : 'Estos documentos ya están') : `${best.matched} de los ${chosen} documentos ya están`;
  const others = matches.length - 1;
  const more = others > 0 ? ` También aparecen en ${others === 1 ? 'otra oportunidad' : `${others} oportunidades más`}.` : '';
  if (!best.readable) return { text: `${how} en una oportunidad que tu equipo cargó el ${day(best.createdAt)}. Pídele acceso a un administrador antes de cargarla de nuevo.${more}`, open: null };
  const title = String(best.title || 'Oportunidad').replace(/\s+/g, ' ').trim();
  return { text: `${how} en «${title.length > 90 ? `${title.slice(0, 89)}…` : title}», cargada el ${day(best.createdAt)}. Ábrela en vez de cargarla de nuevo: así no se repite el informe.${more}`, open: best };
}
