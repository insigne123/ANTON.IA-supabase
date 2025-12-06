import { NextResponse } from 'next/server';
import { qualityChecks } from '@/lib/email-quality';
import type { ChatMessage, StyleProfile } from '@/lib/types';
import { defaultStyle } from '@/lib/style-profiles-storage';
import { updateStyleProfile } from '@/ai/flows/update-style-profile';

// Render: llama a tu endpoint existente de render (servidor a servidor)
async function renderEmail(style: StyleProfile, mode: 'leads' | 'opportunities', sampleData: any) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/email/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // tu render ya conoce "template" y "data"; añadimos styleProfile como "hints"
    body: JSON.stringify({ mode, data: sampleData, styleProfile: style }),
    cache: 'no-store',
  }).catch(() => null);

  if (!res || !res.ok) {
    // fallback muy simple si /api/email/render no existe
    const subj = `[${style.tone}] {{company.name}} · ${style.cta?.label || 'Conversación breve'}`;
    const body =
      `Hola {{lead.firstName}},

Soy de Innovatech. Vi {{company.name}} y creo que podemos aportar valor con X.
¿${style.cta?.duration || '15'} min esta semana?

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
    const lastMessage = (messages as ChatMessage[]).slice().reverse().find(m => m.role === 'user')?.content || '';

    // (1) Actualizar estilo con IA Real (Genkit + Gemini)
    let updated = { ...base };
    let explanation = '';

    if (lastMessage) {
      const aiResult = await updateStyleProfile({
        currentStyle: base,
        userInstruction: lastMessage,
        sampleLead: sampleData
      });
      // Mezclamos el resultado de la IA con el estilo base
      updated = {
        ...base,
        ...aiResult.updatedStyle,
        updatedAt: new Date().toISOString()
      };
      explanation = aiResult.explanation;
    }

    // (2) Render seguro
    const sample = loadSampleFromClient(sampleData);
    const preview = await renderEmail(updated, mode, sample);

    // (3) Calidad
    const qc = qualityChecks(preview.subject, preview.body, updated);

    return NextResponse.json({
      styleProfile: updated,
      // Si la IA dio una explicación, la devolvemos como mensaje del asistente
      explanation,
      preview,
      warnings: qc.warnings,
    });
  } catch (e: any) {
    console.error('Error in chat style API:', e);
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
