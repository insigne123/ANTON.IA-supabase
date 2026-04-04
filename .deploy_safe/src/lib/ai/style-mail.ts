
// src/lib/ai/style-mail.ts
// Genera borradores aplicando un perfil de Email Studio sobre la investigación n8n.
// Listo para reemplazar por un endpoint LLM en el futuro.

import { ensureSubjectPrefix } from "@/lib/outreach-templates";
import { renderTemplate } from "@/lib/template";
import { applySignaturePlaceholders, buildSenderInfo } from "@/lib/signature-placeholders";
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

export function generateMailFromStyle(
  profile: StyleProfile,
  report: ResearchInput | null,
  lead: LeadInput
): { subject: string; body: string } {
  const sender = buildSenderInfo();
  const companyName = lead.companyName || report?.company?.name || "";
  const leadFirstName = (lead.fullName || "").split(" ")[0] || "";

  // 1) Punto de partida: si el perfil tiene plantillas, úsalas; si no, usa el borrador del reporte (si existe).
  let subject = (profile as any).subjectTemplate || report?.emailDraft?.subject || "Propuesta";
  let body =
    (profile as any).bodyTemplate ||
    report?.emailDraft?.body ||
    `Hola {{lead.firstName}},\n\nViendo {{company.name}}, creo que podemos ayudar con: {{report.pains}}\n\n¿Te parece coordinar una llamada de 15 minutos esta semana?\n\nSaludos,\n{{sender.name}}\n{{sender.company}}`;

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
    sender,
    report: {
      overview: report?.overview || "",
      pains: (report?.pains || []).join("; "),
      valueProps: (report?.valueProps || []).join("; "),
      useCases: (report?.useCases || []).join("; "),
      talkTracks: (report?.talkTracks || []).join("; "),
    },
  };

  subject = renderTemplate(subject, ctx);
  body = renderTemplate(body, ctx);

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
    body = words.slice(0, 160).join(" ") + (words.length > 160 ? "…" : "");
  }

  const ctaLabel = (profile as any)?.cta?.label as string | undefined;
  const ctaDur = (profile as any)?.cta?.duration as string | undefined;
  if (ctaLabel || ctaDur) {
    const hasCTA = /15 ?min|10 ?min|20 ?min|agendar|reunión|llamada/i.test(body);
    if (!hasCTA) {
      body += `\n\n${ctaLabel || `¿${ctaDur || "15"} min esta semana?`}`;
    }
  }

  // Firma y prefijo
  body = applySignaturePlaceholders(body, sender);
  subject = ensureSubjectPrefix(subject, leadFirstName);

  body = htmlToPlainParas(body);

  return { subject, body };
}
