import type { ContactabilityResult } from '@/lib/commercial-intelligence';

export type CampaignQaSeverity = 'pass' | 'review' | 'blocked';

export type CampaignQaCheck = {
  id: string;
  label: string;
  severity: CampaignQaSeverity;
  message: string;
};

export type CampaignQaResult = {
  status: CampaignQaSeverity;
  label: string;
  description: string;
  checks: CampaignQaCheck[];
  blockedCount: number;
  reviewCount: number;
};

type CampaignQaInput = {
  email?: string | null;
  subject?: string | null;
  body?: string | null;
  usePixel?: boolean;
  useLinkTracking?: boolean;
  useReadReceipt?: boolean;
  contactability?: ContactabilityResult | null;
  contactabilityLoading?: boolean;
  contactabilityError?: string | null;
};

function isValidEmail(email: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function hasUnresolvedPlaceholder(value: string) {
  if (/\{\{[^}]+\}\}/.test(value)) return true;
  return /\[\s*(?:nombre|name|empresa|company|cargo|title|correo|email|telefono|phone|web|sitio)\s*\]/i.test(value);
}

function countLinks(value: string) {
  return (value.match(/https?:\/\//gi) || []).length;
}

function countRiskyPhrases(value: string) {
  const text = value.toLowerCase();
  const phrases = [
    '100%',
    'actua ahora',
    'compra ahora',
    'dinero rapido',
    'garantizado',
    'gratis',
    'haz click',
    'oferta limitada',
    'sin costo',
    'ultima oportunidad',
    'urgente',
  ];
  return phrases.filter((phrase) => text.includes(phrase)).length;
}

function push(checks: CampaignQaCheck[], check: CampaignQaCheck) {
  checks.push(check);
}

export function assessCampaignQa(input: CampaignQaInput): CampaignQaResult {
  const checks: CampaignQaCheck[] = [];
  const email = String(input.email || '').trim().toLowerCase();
  const subject = String(input.subject || '').trim();
  const body = String(input.body || '').trim();
  const combined = `${subject}\n${body}`;

  if (!email) {
    push(checks, {
      id: 'recipient',
      label: 'Destinatario',
      severity: 'blocked',
      message: 'Agrega un email valido antes de enviar.',
    });
  } else if (!isValidEmail(email)) {
    push(checks, {
      id: 'recipient',
      label: 'Destinatario',
      severity: 'blocked',
      message: 'El formato del email no parece valido.',
    });
  } else if (input.contactabilityLoading) {
    push(checks, {
      id: 'contactability',
      label: 'Contactabilidad',
      severity: 'review',
      message: 'Estamos verificando bajas, dominios bloqueados y rebotes recientes.',
    });
  } else if (input.contactability?.status === 'blocked' || input.contactability?.status === 'missing_email') {
    push(checks, {
      id: 'contactability',
      label: 'Contactabilidad',
      severity: 'blocked',
      message: input.contactability.description,
    });
  } else if (input.contactability?.status === 'warning') {
    push(checks, {
      id: 'contactability',
      label: 'Contactabilidad',
      severity: 'review',
      message: input.contactability.description,
    });
  } else if (input.contactabilityError) {
    push(checks, {
      id: 'contactability',
      label: 'Contactabilidad',
      severity: 'review',
      message: 'No pudimos confirmar el estado de contacto. Si tienes dudas, reintenta antes de enviar.',
    });
  } else {
    push(checks, {
      id: 'contactability',
      label: 'Contactabilidad',
      severity: 'pass',
      message: 'No hay bloqueos conocidos para este destinatario.',
    });
  }

  if (!subject) {
    push(checks, {
      id: 'subject',
      label: 'Asunto',
      severity: 'blocked',
      message: 'Escribe un asunto antes de enviar.',
    });
  } else if (subject.length > 100) {
    push(checks, {
      id: 'subject',
      label: 'Asunto',
      severity: 'review',
      message: 'El asunto es largo. Uno mas corto suele funcionar mejor.',
    });
  } else {
    push(checks, {
      id: 'subject',
      label: 'Asunto',
      severity: 'pass',
      message: 'El asunto esta listo para revisar visualmente.',
    });
  }

  if (!body) {
    push(checks, {
      id: 'body',
      label: 'Contenido',
      severity: 'blocked',
      message: 'Escribe el cuerpo del email antes de enviar.',
    });
  } else if (body.length < 80) {
    push(checks, {
      id: 'body',
      label: 'Contenido',
      severity: 'review',
      message: 'El email es muy breve. Verifica que tenga contexto y una accion clara.',
    });
  } else {
    push(checks, {
      id: 'body',
      label: 'Contenido',
      severity: 'pass',
      message: 'El cuerpo tiene suficiente contexto para un primer envio.',
    });
  }

  if (hasUnresolvedPlaceholder(combined)) {
    push(checks, {
      id: 'placeholders',
      label: 'Personalizacion',
      severity: 'blocked',
      message: 'Hay placeholders sin resolver. Reemplazalos antes de enviar.',
    });
  } else {
    push(checks, {
      id: 'placeholders',
      label: 'Personalizacion',
      severity: 'pass',
      message: 'No detectamos placeholders visibles.',
    });
  }

  const links = countLinks(body);
  const riskyPhrases = countRiskyPhrases(combined);
  const shouting = subject.length > 12 && subject === subject.toUpperCase() && /[A-Z]/.test(subject);
  const manyExclamations = (combined.match(/!/g) || []).length >= 3;
  if (links > 5 || riskyPhrases > 1 || shouting || manyExclamations) {
    push(checks, {
      id: 'deliverability-copy',
      label: 'Copy y deliverability',
      severity: 'review',
      message: 'Hay senales que pueden aumentar friccion: exceso de links, urgencia o tono promocional.',
    });
  } else {
    push(checks, {
      id: 'deliverability-copy',
      label: 'Copy y deliverability',
      severity: 'pass',
      message: 'No detectamos senales fuertes de copy riesgoso.',
    });
  }

  if (input.useReadReceipt) {
    push(checks, {
      id: 'read-receipt',
      label: 'Confirmacion de lectura',
      severity: 'review',
      message: 'El destinatario podria ver una solicitud formal de confirmacion.',
    });
  }

  if (!input.usePixel && !input.useLinkTracking) {
    push(checks, {
      id: 'tracking',
      label: 'Tracking',
      severity: 'review',
      message: 'Sin pixel ni clicks, tendras menos senales para follow-up.',
    });
  } else if (input.usePixel && input.useLinkTracking) {
    push(checks, {
      id: 'tracking',
      label: 'Tracking',
      severity: 'pass',
      message: 'Tracking listo. El footer de baja se agregara en el envio.',
    });
  } else {
    push(checks, {
      id: 'tracking',
      label: 'Tracking',
      severity: 'pass',
      message: 'Tracking moderado y suficiente para medir respuesta.',
    });
  }

  const blockedCount = checks.filter((check) => check.severity === 'blocked').length;
  const reviewCount = checks.filter((check) => check.severity === 'review').length;
  const status: CampaignQaSeverity = blockedCount > 0 ? 'blocked' : reviewCount > 0 ? 'review' : 'pass';

  return {
    status,
    label: status === 'blocked' ? 'Necesita correccion' : status === 'review' ? 'Listo con observaciones' : 'Listo para enviar',
    description: status === 'blocked'
      ? 'Corrige los puntos bloqueantes antes de enviar.'
      : status === 'review'
        ? 'Puedes enviar, pero conviene revisar estos detalles primero.'
        : 'No encontramos bloqueos ni senales relevantes de riesgo.',
    checks,
    blockedCount,
    reviewCount,
  };
}
