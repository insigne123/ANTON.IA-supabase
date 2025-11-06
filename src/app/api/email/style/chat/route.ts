import { NextResponse } from 'next/server';
import { qualityChecks } from '@/lib/email-quality';
import type { ChatMessage, StyleProfile } from '@/lib/types';
import { defaultStyle } from '@/lib/style-profiles-storage';

/**
 * Minimal: aplica reglas simples a partir del último mensaje.
 * Reemplaza esta función por tu LLM (Gemini/OpenAI) cuando quieras.
 */
function ruleBasedUpdateStyle(messages: ChatMessage[], prev: StyleProfile): StyleProfile {
  const last = (messages || []).slice().reverse().find(m => m.role === 'user')?.content.toLowerCase() || '';
  const style = { ...prev };

  // tono
  if (/cálid|calid|amable|cercan/.test(last)) style.tone = 'warm';
  if (/direct|al grano|conciso/.test(last)) style.tone = 'direct';
  if (/challenger|retador|provoc/.test(last)) style.tone = 'challenger';
  if (/profes/.test(last)) style.tone = 'professional';
  if (/breve|corto|muy corto/.test(last)) style.length = 'short';
  if (/largo|detallado/.test(last)) style.length = 'long';

  // estructura
  if (/quitar.*prueba|sin prueba social/.test(last)) style.structure = style.structure.filter(x => x !== 'proof');
  if (/agrega.*prueba|incluye prueba social/.test(last) && !style.structure.includes('proof')) style.structure.splice(3, 0, 'proof');

  // CTA
  if (/10 ?min/.test(last)) style.cta = { label: '¿10 min?', duration: '10' };
  if (/15 ?min/.test(last)) style.cta = { label: '¿15 min?', duration: '15' };
  if (/20 ?min/.test(last)) style.cta = { label: '¿20 min?', duration: '20' };
  if (/sin cta/.test(last)) style.cta = { label: '', duration: undefined };

  // personalización
  if (/usa.*nombre/.test(last)) style.personalization.useLeadName = true;
  if (/no.*nombre/.test(last)) style.personalization.useLeadName = false;
  if (/usa.*empresa/.test(last)) style.personalization.useCompanyName = true;
  if (/no.*empresa/.test(last)) style.personalization.useCompanyName = false;

  style.updatedAt = new Date().toISOString();
  return style;
}

// Render: llama a tu endpoint existente de render (servidor a servidor)
async function renderEmail(style: StyleProfile, mode: 'leads'|'opportunities', sampleData: any) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/email/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // tu render ya conoce "template" y "data"; añadimos styleProfile como "hints"
    body: JSON.stringify({ mode, data: sampleData, styleProfile: style }),
    cache: 'no-store',
  }).catch(() => null);

  if (!res || !res.ok) {
    // fallback muy simple si /api/email/render no existe
    const subj = `[${style.tone}] {{company.name}} · ${style.cta.label || 'Conversación breve'}`;
    const body =
`Hola {{lead.firstName}},

Soy de Innovatech. Vi {{company.name}} y creo que podemos aportar valor con X.
¿${style.cta.duration || '15'} min esta semana?

Saludos,
—`;
    return { subject: subj, body };
  }
  const j = await res.json();
  return { subject: j.subject || '', body: j.body || '' };
}

/**
 * Carga un ejemplo para vista previa.
 * Si quieres, trae de enrichedLeadsStorage/opportunities. Aquí aceptamos sampleData directo.
 */
function loadSampleFromClient(data: any) {
  return data || {
    companyProfile: {},
    report: {},
    lead: { name: 'María', title: 'Directora de Marketing' },
    job: undefined,
  };
}

export async function POST(req: Request) {
  try {
    const { messages, styleProfile, mode = 'leads', sampleData } = await req.json();

    const base: StyleProfile = styleProfile || { ...defaultStyle, scope: mode };
    // (1) Actualizar estilo
    const updated = ruleBasedUpdateStyle(messages as ChatMessage[], base);

    // (2) Render seguro
    const sample = loadSampleFromClient(sampleData);
    const preview = await renderEmail(updated, mode, sample);

    // (3) Calidad
    const qc = qualityChecks(preview.subject, preview.body, updated);

    return NextResponse.json({
      styleProfile: updated,
      preview,
      warnings: qc.warnings,
    });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
