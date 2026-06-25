import type { SupliaArtifact } from '@/lib/suplia/types';
import type { SupliaIntentResult } from '@/lib/suplia/intent';

export function selectSupliaArtifactUpdateTarget(
  intent: SupliaIntentResult,
  activeArtifactId: string | null | undefined,
  artifacts: Array<Pick<SupliaArtifact, 'id'>>,
) {
  if (intent.intent !== 'artifact_update') return null;
  if (activeArtifactId && artifacts.some((artifact) => artifact.id === activeArtifactId)) return activeArtifactId;
  return artifacts[0]?.id || null;
}

export function buildSupliaArtifactChangeSummary(instruction: string) {
  const clean = String(instruction || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Actualizacion solicitada desde el chat.';
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

export function buildSupliaArtifactRestoreSummary(versionNumber: number) {
  const safeVersion = Math.max(1, Math.floor(Number(versionNumber || 1)));
  return `Restaurado desde la version ${safeVersion}.`;
}
