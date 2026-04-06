export const privacyRequestTypes = [
  { value: 'access', label: 'Acceso' },
  { value: 'rectification', label: 'Rectificacion' },
  { value: 'deletion', label: 'Supresion o eliminacion' },
  { value: 'opposition', label: 'Oposicion al tratamiento' },
  { value: 'portability', label: 'Portabilidad' },
  { value: 'blocking', label: 'Bloqueo temporal' },
  { value: 'other', label: 'Otra solicitud' },
] as const;

export const privacyRequestRelations = [
  { value: 'self', label: 'Soy el titular' },
  { value: 'authorized', label: 'Actuo con autorizacion' },
  { value: 'unknown', label: 'Prefiero explicarlo en el detalle' },
] as const;

export type PrivacyRequestType = (typeof privacyRequestTypes)[number]['value'];
export type PrivacyRequestRelation = (typeof privacyRequestRelations)[number]['value'];

export type PrivacyRequestPayload = {
  requestType: PrivacyRequestType;
  requesterName: string;
  requesterEmail: string;
  requesterCompany?: string;
  relationToData?: PrivacyRequestRelation;
  targetEmail?: string;
  details: string;
};

function normalize(value: unknown) {
  return String(value || '').trim();
}

function normalizeEmail(value: unknown) {
  return normalize(value).toLowerCase();
}

export function validatePrivacyRequestPayload(input: any): { ok: true; value: PrivacyRequestPayload } | { ok: false; error: string } {
  const requestType = normalize(input?.requestType) as PrivacyRequestType;
  const requesterName = normalize(input?.requesterName);
  const requesterEmail = normalizeEmail(input?.requesterEmail);
  const requesterCompany = normalize(input?.requesterCompany);
  const relationToData = normalize(input?.relationToData) as PrivacyRequestRelation;
  const targetEmail = normalizeEmail(input?.targetEmail || requesterEmail);
  const details = normalize(input?.details);

  const validTypes = new Set(privacyRequestTypes.map((item) => item.value));
  const validRelations = new Set(privacyRequestRelations.map((item) => item.value));

  if (!validTypes.has(requestType)) {
    return { ok: false, error: 'Tipo de solicitud invalido.' };
  }

  if (!requesterName || requesterName.length < 3) {
    return { ok: false, error: 'Ingresa tu nombre completo.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
    return { ok: false, error: 'Ingresa un correo valido.' };
  }

  if (relationToData && !validRelations.has(relationToData)) {
    return { ok: false, error: 'Relacion con los datos invalida.' };
  }

  if (targetEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    return { ok: false, error: 'El correo de los datos consultados no es valido.' };
  }

  if (!details || details.length < 20) {
    return { ok: false, error: 'Describe tu solicitud con un poco mas de detalle.' };
  }

  return {
    ok: true,
    value: {
      requestType,
      requesterName,
      requesterEmail,
      requesterCompany: requesterCompany || undefined,
      relationToData: relationToData || undefined,
      targetEmail: targetEmail || undefined,
      details,
    },
  };
}
