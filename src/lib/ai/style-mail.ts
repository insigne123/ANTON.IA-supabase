
// src/lib/ai/style-mail.ts
// Genera borradores aplicando un perfil de Email Studio sobre la investigación n8n.

import { ensureSubjectPrefix } from "@/lib/outreach-templates";
import { renderTemplate } from "@/lib/template";
import { applySignaturePlaceholders, buildSenderInfo, type CompanyProfileInfo, type SenderInfo } from "@/lib/signature-placeholders";
import type { StyleProfile } from "@/lib/types";

export type LeadInput = {
  id?: string;
  fullName?: string;
  email?: string;
  title?: string;
  companyName?: string;
  companyDomain?: string;
  linkedinUrl?: string;
};

export type ResearchInput = {
  overview?: string;
  pains?: string[];
  valueProps?: string[];
  useCases?: string[];
  talkTracks?: string[];
  emailDraft?: { subject?: string; body?: string };
  company?: { name?: string; domain?: string };
};

type GenerateMailOptions = {
  sender?: SenderInfo;
  companyProfile?: CompanyProfileInfo;
};

function htmlToPlainParas(htmlOrText: string): string {
  if (!htmlOrText) return '';
  let s = String(htmlOrText);

  // Normalizar saltos
  s = s.replace(/\r\n/g, '\n');

  // Quebrar donde corresponda
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n');

  // Bullets básicos
  s = s.replace(/<li[^>]*>/gi, '• ');

  // Quitar el resto de etiquetas
  s = s.replace(/<\/?[^>]+>/g, '');

  // Colapsar espacios y normalizar párrafos
  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s;
}

function normalizeTemplateFallbacks(template: string): string {
  return template.replace(
    /\{\{\s*cta\.duration\s*\|\|\s*["'][^"']*["']\s*\}\}/gi,
    '{{cta.duration}}'
  );
}

function normalizeCtaDuration(value?: string): string {
  const duration = String(value || '').match(/\d{1,3}/)?.[0];
  return duration || '15';
}

function normalizeForMatching(value?: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function applyInstructionHints(body: string, profile: StyleProfile): string {
  const instructions = normalizeForMatching(profile.instructions);
  if (!instructions) return body;

  let nextBody = body;
  if (/\b(sin|evita|evitar)\s+(emojis?|emoticones?)\b/.test(instructions)) {
    nextBody = nextBody.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').trim();
  }

  const asksForBrevity = /\b(breve|corto|corta|conciso|concisa|directo|directa)\b/.test(instructions);
  if (asksForBrevity) {
    const words = nextBody.split(/\s+/);
    if (words.length > 90) {
      nextBody = `${words.slice(0, 90).join(' ')}…`;
    }
  }

  return nextBody;
}

export function generateMailFromStyle(
  profile: StyleProfile,
  report: ResearchInput | null,
  lead: LeadInput,
  options: GenerateMailOptions = {}
): { subject: string; body: string } {
  const sender = options.sender || buildSenderInfo();
  const companyName = lead.companyName || report?.company?.name || "";
  const companyProfile = {
    name: options.companyProfile?.name || sender.company || '',
    sector: options.companyProfile?.sector || '',
    description: options.companyProfile?.description || '',
    services: options.companyProfile?.services || '',
    valueProposition: options.companyProfile?.valueProposition || '',
    website: options.companyProfile?.website || sender.website || '',
    domain: options.companyProfile?.domain || '',
  };
  const leadFirstName = (lead.fullName || "").split(" ")[0] || "";
  const ctaLabel = profile.cta?.label?.trim();
  const ctaDuration = normalizeCtaDuration(profile.cta?.duration);

  // 1) Punto de partida: si el perfil tiene plantillas, úsalas; si no, usa el borrador del reporte (si existe).
  let subject = profile.subjectTemplate || report?.emailDraft?.subject || "Propuesta";
  let body =
    profile.bodyTemplate ||
    report?.emailDraft?.body ||
    `Hola {{lead.firstName}},\n\nViendo {{company.name}}, creo que podemos ayudar con: {{report.pains}}\n\n¿Te parece coordinar una llamada de {{cta.duration}} minutos esta semana?\n\nSaludos,\n{{sender.name}}\n{{sender.company}}`;

  subject = normalizeTemplateFallbacks(subject);
  body = normalizeTemplateFallbacks(body);

  // 2) Contexto para placeholders
  const ctx = {
    lead: {
      firstName: leadFirstName,
      name: lead.fullName || "",
      email: lead.email || "",
      title: lead.title || "",
      company: companyName,
    },
    company: {
      name: companyName,
      domain: lead.companyDomain || report?.company?.domain || "",
    },
    companyProfile,
    sender,
    cta: {
      label: ctaLabel || '',
      duration: ctaDuration,
    },
    report: {
      overview: report?.overview || "su iniciativa actual de crecimiento",
      pains: (report?.pains || []).join("; ") || "prioridades comerciales y operativas del equipo",
      valueProps: (report?.valueProps || []).join("; ") || "automatizacion comercial, mejor priorizacion y seguimiento consistente",
      useCases: (report?.useCases || []).join("; ") || "casos de prospeccion, seguimiento y activacion de pipeline",
      talkTracks: (report?.talkTracks || []).join("; ") || "un enfoque practico y rapido de implementar",
    },
  };

  subject = renderTemplate(subject, ctx);
  body = renderTemplate(body, ctx);
  body = body.replace(/\bde\s+min\b/gi, `de ${ctaDuration} min`);

  // 3) Ajustes rápidos según estilo (tono/longitud/cta)
  const tone = (profile.tone || "").toString().toLowerCase();
  if (tone.includes("direct")) {
    body = body.replace(/\n\n+/g, "\n\n").replace(/\b(muy|sumamente)\b/gi, "");
  } else if (tone.includes("warm") || tone.includes("cálid") || tone.includes("calid")) {
    body = body.replace(/\n\n/g, "\n\n🙂 ");
  }

  const length = (profile.length || "").toString().toLowerCase();
  if (length.includes("short") || length.includes("corto") || length.includes("breve")) {
    const words = body.split(/\s+/);
    if (words.length > 100) {
      body = `${words.slice(0, 100).join(" ")}…`;
    }
  }

  if (ctaLabel || profile.cta?.duration) {
    const hasCTA = /15 ?min|10 ?min|20 ?min|agendar|reunión|llamada/i.test(body);
    if (!hasCTA) {
      body += `\n\n${ctaLabel || `¿${ctaDuration} min esta semana?`}`;
    }
  }

  body = applyInstructionHints(body, profile);

  // Firma y prefijo
  body = applySignaturePlaceholders(body, sender);
  subject = ensureSubjectPrefix(subject, leadFirstName);

  body = htmlToPlainParas(body);

  return { subject, body };
}
