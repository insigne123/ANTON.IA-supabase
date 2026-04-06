export const privacyIncidentStatuses = [
  { value: 'detected', label: 'Detectado' },
  { value: 'contained', label: 'Contenido' },
  { value: 'resolved', label: 'Resuelto' },
  { value: 'dismissed', label: 'Descartado' },
] as const;

export const privacyIncidentSeverities = [
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
] as const;

export type PrivacyIncidentStatus = (typeof privacyIncidentStatuses)[number]['value'];
export type PrivacyIncidentSeverity = (typeof privacyIncidentSeverities)[number]['value'];

export function validatePrivacyIncidentPayload(input: any): { ok: true; value: any } | { ok: false; error: string } {
  const title = String(input?.title || '').trim();
  const summary = String(input?.summary || '').trim();
  const severity = String(input?.severity || '').trim() as PrivacyIncidentSeverity;
  const status = String(input?.status || '').trim() as PrivacyIncidentStatus;
  const affectedScope = String(input?.affectedScope || '').trim();
  const dataTypes = String(input?.dataTypes || '').trim();
  const resolutionNotes = String(input?.resolutionNotes || '').trim();

  const validSeverities = new Set(privacyIncidentSeverities.map((item) => item.value));
  const validStatuses = new Set(privacyIncidentStatuses.map((item) => item.value));

  if (!title || title.length < 5) return { ok: false, error: 'Ingresa un titulo mas descriptivo.' };
  if (!summary || summary.length < 15) return { ok: false, error: 'Describe el incidente con mas detalle.' };
  if (!validSeverities.has(severity)) return { ok: false, error: 'Severidad invalida.' };
  if (!validStatuses.has(status)) return { ok: false, error: 'Estado invalido.' };

  return {
    ok: true,
    value: {
      title,
      summary,
      severity,
      status,
      affectedScope: affectedScope || null,
      dataTypes: dataTypes || null,
      resolutionNotes: resolutionNotes || null,
    },
  };
}
