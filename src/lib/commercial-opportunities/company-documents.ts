// «Documentos de la empresa»: what almost every tender asks for again and again (F30, certificate of good standing,
// financial statements, ISO certificates), kept once with their expiry, so the team is warned before one lapses and the
// AI knows what is current. Pure: the server (workspace-company-documents.ts), the page and the prompts share it.
import { z } from 'zod';

export const COMPANY_DOCUMENT_KINDS = {
  f30: { label: 'Certificado F30', hint: 'Antecedentes laborales y previsionales (Dirección del Trabajo). Las bases suelen pedirlo con menos de 30 días.', days: 30 },
  f30_1: { label: 'Certificado F30-1', hint: 'Cumplimiento de obligaciones laborales y previsionales. Suele pedirse al firmar y en cada pago.', days: 30 },
  vigencia: { label: 'Certificado de vigencia de la sociedad', hint: 'Registro de Empresas y Sociedades o Conservador. Suele pedirse con menos de 60 días.', days: 60 },
  poder: { label: 'Vigencia del poder del representante legal', hint: 'Para quien firma la oferta y el contrato.', days: 60 },
  estados_financieros: { label: 'Estados financieros', hint: 'Balance y estado de resultados del último año.', days: null },
  iso: { label: 'Certificado ISO', hint: 'Con la fecha de vencimiento que indica el certificado.', days: null },
  otro: { label: 'Otro documento', hint: 'Seguro, patente municipal, acreditación u otro que las bases pidan seguido.', days: null },
} as const;
export type CompanyDocumentKind = keyof typeof COMPANY_DOCUMENT_KINDS;
export const companyDocumentKinds = Object.keys(COMPANY_DOCUMENT_KINDS) as [CompanyDocumentKind, ...CompanyDocumentKind[]];

export const companyDocumentInputSchema = z.object({
  kind: z.enum(companyDocumentKinds),
  label: z.string().trim().min(2).max(200),
  /** The day it stops being valid (yyyy-mm-dd), or null when it does not lapse. */
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T12:00:00Z`)), 'Revisa la fecha.').nullable(),
}).strict();

export type CompanyDocument = { id: string; kind: CompanyDocumentKind; label: string; fileName: string; expiresAt: string | null; createdAt: string };
export type CompanyDocumentStatus = 'vigente' | 'por_vencer' | 'vencido' | 'sin_fecha';
/** Warned this many days before: enough to ask for a new F30 or certificate. */
export const EXPIRY_WARNING_DAYS = 15;

/** Today in Chile as yyyy-mm-dd: a document expiring «today» is still valid all of today. */
export const chileToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T12:00:00Z`) / 86_400_000);

export function companyDocumentStatus(expiresAt: string | null, today = chileToday()): { status: CompanyDocumentStatus; daysLeft: number | null } {
  if (!expiresAt) return { status: 'sin_fecha', daysLeft: null };
  const daysLeft = dayNumber(expiresAt) - dayNumber(today);
  return { status: daysLeft < 0 ? 'vencido' : daysLeft <= EXPIRY_WARNING_DAYS ? 'por_vencer' : 'vigente', daysLeft };
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const documentDay = (day: string) => { const [y, m, d] = day.split('-').map(Number); return `${d} de ${MONTHS[m - 1]} de ${y}`; };

/** «Vence en 5 días», «Venció el 3 de octubre de 2026», «Vigente hasta el …», «Sin vencimiento». */
export function companyDocumentLabel(expiresAt: string | null, today = chileToday()) {
  const { status, daysLeft } = companyDocumentStatus(expiresAt, today);
  if (status === 'sin_fecha') return 'Sin vencimiento';
  if (status === 'vencido') return `Venció el ${documentDay(expiresAt!)}`;
  if (status === 'por_vencer') return daysLeft === 0 ? 'Vence hoy' : daysLeft === 1 ? 'Vence mañana' : `Vence en ${daysLeft} días`;
  return `Vigente hasta el ${documentDay(expiresAt!)}`;
}

/** The suggested expiry when the person gives the issue date of a document that lapses by age (F30, certificate of good standing). */
export function suggestedExpiry(kind: CompanyDocumentKind, issuedAt: string) {
  const days = COMPANY_DOCUMENT_KINDS[kind].days;
  if (!days || !/^\d{4}-\d{2}-\d{2}$/.test(issuedAt)) return null;
  return new Date(Date.parse(`${issuedAt}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The alerts of the page: lapsed or about to, soonest first. */
export function companyDocumentAlerts(documents: Array<Pick<CompanyDocument, 'id' | 'label' | 'expiresAt'>>, today = chileToday()) {
  return documents.map(document => ({ ...document, ...companyDocumentStatus(document.expiresAt, today) }))
    .filter(document => document.status === 'vencido' || document.status === 'por_vencer')
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .map(document => ({ id: document.id, label: document.label, expiresAt: document.expiresAt!, status: document.status as 'vencido' | 'por_vencer', text: `${document.label}: ${companyDocumentLabel(document.expiresAt, today).toLowerCase()}` }));
}

/** The folder as the model reads it: what the company has, and whether it is current today. */
export function companyDocumentsForModel(documents: Array<Pick<CompanyDocument, 'kind' | 'label' | 'expiresAt'>>, today = chileToday()) {
  return documents.slice(0, 40).map(document => ({ documento: document.label, tipo: COMPANY_DOCUMENT_KINDS[document.kind]?.label ?? document.kind,
    estado: companyDocumentLabel(document.expiresAt, today).toLowerCase() }));
}
