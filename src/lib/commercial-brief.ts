/** Shared factual envelope for chat, native drafting and replies. Data is not instructions.
 * Keep seller assertions verbatim; recipient evidence never expands the seller's offer. */
export type CommercialBriefInput = {
  request: string; offer?: string | null; services?: string[]; proofPoints?: string[]; differentiators?: string[];
  sender?: { name?: string | null; company?: string | null; title?: string | null };
  audience?: unknown; relationship?: 'initial' | 'follow_up' | 'reply' | 'edit'; evidence?: unknown[]; previous?: unknown;
};
export function commercialBrief(input: CommercialBriefInput) {
  return { version: 'commercial-brief/v1', request: input.request, activeOffer: input.offer ?? null,
    requestDeclarations: { text: input.request, authority: 'user_intent_and_explicit_seller_declarations_not_recipient_evidence',
      rule: 'Una oferta o prueba que el usuario declara expresamente para este encargo prevalece sobre defaults de otro producto. Un correo pegado para editar no aprueba sus cifras, garantías ni superlativos.' },
    seller: { services: input.services ?? [], proofPoints: input.proofPoints ?? [], differentiators: input.differentiators ?? [],
      authority: 'seller_declared_not_external_verification' },
    sender: input.sender ?? null, audience: input.audience ?? null, relationship: input.relationship ?? 'initial',
    evidence: input.evidence ?? [], previous: input.previous ?? null,
    constraints: ['La oferta explícita del pedido prevalece; las pruebas se usan solo para el producto y alcance al que pertenecen.',
      'Conservar sujeto, unidades, condiciones y tiempo verbal de cada prueba.',
      'El cargo orienta relevancia, no acredita autoridad, presupuesto ni necesidades.',
      'Editar conserva relación, destinatarios, hechos, adjuntos y decisiones aceptadas; no introduce otra venta.',
      'Una pregunta sobre el texto no autoriza enviar ni activar nada.'] };
}
