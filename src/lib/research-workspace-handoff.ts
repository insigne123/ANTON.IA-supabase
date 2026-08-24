import { MAX_RESEARCH_BATCH_SIZE } from '@/lib/research-workspace';

// Temporary, tab-scoped selection transfer. Research output remains server-persisted.
export const RESEARCH_WORKSPACE_HANDOFF_STORAGE_KEY = 'anton.research.selection-handoff.v1';

const HANDOFF_VERSION = 1;
const HANDOFF_TTL_MS = 30 * 60 * 1000;

export type ResearchWorkspaceHandoffSource = 'enriched-leads' | 'enriched-opportunities';

export type ResearchWorkspaceHandoff = {
  version: typeof HANDOFF_VERSION;
  source: ResearchWorkspaceHandoffSource;
  leadIds: string[];
  refresh: boolean;
  createdAt: number;
};

type HandoffInput = {
  source: ResearchWorkspaceHandoffSource;
  leadIds: readonly string[];
  refresh?: boolean;
  createdAt?: number;
};

export type ResearchWorkspaceHandoffResult =
  | { ok: true; handoff: ResearchWorkspaceHandoff }
  | { ok: false; message: string };

function isHandoffSource(value: unknown): value is ResearchWorkspaceHandoffSource {
  return value === 'enriched-leads' || value === 'enriched-opportunities';
}

function validLeadId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 200 ? id : null;
}

export function createResearchWorkspaceHandoff(input: HandoffInput): ResearchWorkspaceHandoffResult {
  if (!isHandoffSource(input.source)) {
    return { ok: false, message: 'No pudimos preparar esta selección. Vuelve a intentarlo desde la lista.' };
  }

  const leadIds = input.leadIds.map(validLeadId);
  if (leadIds.some((id) => !id)) {
    return { ok: false, message: 'La selección contiene un lead que ya no está disponible. Actualiza la lista e inténtalo nuevamente.' };
  }

  const normalizedIds = leadIds as string[];
  if (normalizedIds.length === 0) {
    return { ok: false, message: 'Selecciona al menos un lead antes de continuar.' };
  }

  if (normalizedIds.length > MAX_RESEARCH_BATCH_SIZE) {
    return { ok: false, message: `Puedes investigar hasta ${MAX_RESEARCH_BATCH_SIZE} leads por selección. Ajusta la selección para continuar.` };
  }

  if (new Set(normalizedIds).size !== normalizedIds.length) {
    return { ok: false, message: 'La selección cambió. Actualiza la lista e inténtalo nuevamente.' };
  }

  const createdAt = input.createdAt ?? Date.now();
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return { ok: false, message: 'No pudimos preparar esta selección. Vuelve a intentarlo desde la lista.' };
  }

  return {
    ok: true,
    handoff: {
      version: HANDOFF_VERSION,
      source: input.source,
      leadIds: normalizedIds,
      refresh: input.refresh === true,
      createdAt,
    },
  };
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveResearchWorkspaceHandoff(input: HandoffInput): ResearchWorkspaceHandoffResult {
  const result = createResearchWorkspaceHandoff(input);
  if (!result.ok) return result;

  const storage = getSessionStorage();
  if (!storage) {
    return { ok: false, message: 'No pudimos conservar tu selección en este navegador. Inténtalo nuevamente.' };
  }

  try {
    storage.setItem(RESEARCH_WORKSPACE_HANDOFF_STORAGE_KEY, JSON.stringify(result.handoff));
    return result;
  } catch {
    return { ok: false, message: 'No pudimos conservar tu selección en este navegador. Inténtalo nuevamente.' };
  }
}

export function readResearchWorkspaceHandoff(): ResearchWorkspaceHandoffResult | { ok: true; handoff: null } {
  const storage = getSessionStorage();
  if (!storage) return { ok: true, handoff: null };

  let raw: string | null = null;
  try {
    raw = storage.getItem(RESEARCH_WORKSPACE_HANDOFF_STORAGE_KEY);
  } catch {
    return { ok: true, handoff: null };
  }

  if (!raw) return { ok: true, handoff: null };

  try {
    const parsed = JSON.parse(raw) as Partial<ResearchWorkspaceHandoff>;
    if (parsed.version !== HANDOFF_VERSION) throw new Error('invalid version');

    const result = createResearchWorkspaceHandoff({
      source: parsed.source as ResearchWorkspaceHandoffSource,
      leadIds: Array.isArray(parsed.leadIds) ? parsed.leadIds : [],
      refresh: parsed.refresh === true,
      createdAt: parsed.createdAt,
    });
    if (!result.ok) throw new Error('invalid selection');

    const age = Date.now() - result.handoff.createdAt;
    if (age > HANDOFF_TTL_MS || age < -60_000) throw new Error('expired selection');

    return result;
  } catch {
    clearResearchWorkspaceHandoff();
    return { ok: false, message: 'No pudimos recuperar la selección. Vuelve a la lista y selecciónala nuevamente.' };
  }
}

export function clearResearchWorkspaceHandoff() {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(RESEARCH_WORKSPACE_HANDOFF_STORAGE_KEY);
  } catch {
    // The handoff is temporary; there is nothing else to do when cleanup is unavailable.
  }
}
