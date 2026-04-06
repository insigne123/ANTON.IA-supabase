// src/lib/input-sanitize.ts
// Utilidades de sanitización livianas para inputs de búsqueda/filtros.

const BASE = (s: string | null | undefined) =>
  (s ?? '').toString().trim().replace(/\s+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 200);

export function sanitizeName(input: string | null | undefined): string {
  return BASE(input);
}

export function sanitizeTitle(input: string | null | undefined): string {
  // Permite letras, números, espacios y símbolos típicos de cargos
  return BASE(input).replace(/[^\p{L}\p{N}\s\-\.,&/()#+_']/gu, '');
}

export function sanitizeLocation(input: string | null | undefined): string {
  // Ciudades/países; más restrictivo
  return BASE(input).replace(/[^\p{L}\p{N}\s\-,']/gu, '');
}

export function sanitizeQuery(input: string | null | undefined): string {
  return BASE(input).replace(/[<>`$]/g, '');
}

export function sanitizeKeywordsToTagsArray(input: string | null | undefined): string[] {
  const v = BASE(input);
  if (!v) return [];
  // split por coma o por punto y coma; fallback por espacios múltiples
  const parts = v.includes(',') || v.includes(';')
    ? v.split(/[;,]/g)
    : v.split(/\s{2,}/g);
  return parts
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.replace(/[<>`$]/g, '').slice(0, 60));
}
