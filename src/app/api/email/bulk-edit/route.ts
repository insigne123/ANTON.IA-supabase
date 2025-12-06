import { NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Tipos de entrada
const LeadSchema = z.object({
  id: z.string().optional(),
  fullName: z.string().optional(),
  email: z.string().optional(),
  title: z.string().optional(),
  companyName: z.string().optional(),
  companyDomain: z.string().optional(),
  linkedinUrl: z.string().optional(),
});

const DraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  lead: LeadSchema,
});

const InputSchema = z.object({
  instruction: z.string(),
  drafts: z.array(DraftSchema),
});

// Esquema de salida esperado del LLM
const EditedDraftSchema = z.object({
  leadId: z.string().describe("El ID del lead para correlacionar (si disponible) o index"),
  subject: z.string(),
  body: z.string(),
});

const OutputSchema = z.object({
  edits: z.array(EditedDraftSchema),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const { instruction, drafts } = InputSchema.parse(json);

    if (!instruction || !drafts.length) {
      return NextResponse.json({ error: 'Instruction and drafts are required' }, { status: 400 });
    }

    // Preparamos el contexto para el LLM
    // Enviamos solo info relevante para ahorrar tokens, pero suficiente para contexto
    const examples = drafts.slice(0, 20).map((d) => ({
      leadId: d.lead.id || d.lead.email,
      leadName: d.lead.fullName,
      company: d.lead.companyName,
      currentSubject: d.subject,
      currentBody: d.body,
    }));

    const prompt = `
Eres un asistente experto en redacción de correos B2B (Email Marketing).
Tu tarea es modificar una lista de borradores de correo basándote en una instrucción del usuario.

INSTRUCCIÓN DEL USUARIO: "${instruction}"

REGLAS:
1. Aplica la instrucción de manera ORGÁNICA y NATURAL.
2. Si la instrucción pide agregar un link, intégralo en una frase coherente, no lo pegues al final.
3. Respeta el tono original del correo (si es formal, manténlo formal).
4. Mantén los placeholders como {{sender.name}} o la firma si existen.
5. NO inventes información que no esté en la instrucción.
6. Devuelve el JSON exacto con los campos: leadId, subject, body.

LISTA DE BORRADORES A EDITAR:
${JSON.stringify(examples, null, 2)}
    `;

    // Llamada a Genkit
    const result = await ai.generate({
      prompt,
      output: { schema: OutputSchema },
    });

    if (!result?.output?.edits) {
      throw new Error('La IA no devolvió un formato válido.');
    }

    // Reconstruimos la respuesta correlacionando con los originales
    // (En este caso asumimos que devuelve en orden o usamos ID si el modelo es listo)
    // Para seguridad, mapeamos por ID si es posible, o confiamos en el orden si el prompt lo enfatizara.
    // Dado que es bulk edit visual, devolveremos la lista procesada.

    // Mapeo de vuelta a la estructura del cliente
    // Intentamos hacer match por ID
    const editMap = new Map(result.output.edits.map(e => [e.leadId, e]));

    const responseDrafts = drafts.map(original => {
      const id = original.lead.id || original.lead.email;
      const edit = editMap.get(id);
      if (edit) {
        return {
          subject: edit.subject,
          body: edit.body,
          lead: original.lead // mantenemos el lead original
        };
      }
      // Si el LLM se saltó alguno (raro con gemini flash), devolvemos original
      return original;
    });

    return NextResponse.json({ drafts: responseDrafts });

  } catch (e: any) {
    console.error('[bulk-edit] error:', e);
    return NextResponse.json({ error: e.message || 'Error processing with AI' }, { status: 500 });
  }
}
