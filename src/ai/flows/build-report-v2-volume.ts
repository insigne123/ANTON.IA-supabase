import {
  VolumeModelV2Schema,
  type ClaimV2,
  type EntityResolutionV2,
  type GapV2,
  type VolumeModelV2,
} from '@/lib/report-v2-contracts';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';

export type VolumeAssumptionsV2 = {
  scenarioMultipliers?: number[] | null;
  minutesPerEvent?: number | null;
};

function scaleFromClaim(claim: ClaimV2) {
  if (claim.type !== 'fact' || claim.dimension !== 'company_size') return null;
  const match = claim.statement.match(/\b(\d+(?:[.,]\d{3})*)\s+(?:colaboradores|empleados|trabajadores|employees|workers|people)\b/i);
  const value = match ? Number(match[1].replace(/[.,]/g, '')) : null;
  return value && Number.isFinite(value) ? value : null;
}

export function buildReportV2VolumeModel(input: {
  claims: ClaimV2[];
  entity: EntityResolutionV2;
  assumptions?: VolumeAssumptionsV2 | null;
}): { model: VolumeModelV2; assumptions: VolumeModelV2['assumptions']; gap: GapV2 | null } | null {
  const multipliers = (input.assumptions?.scenarioMultipliers || []).filter((value) => Number.isFinite(value) && value > 0).slice(0, 3);
  const minutesPerEvent = Number(input.assumptions?.minutesPerEvent);
  if (multipliers.length !== 3 || !Number.isFinite(minutesPerEvent) || minutesPerEvent <= 0) return null;
  const candidates = input.claims.flatMap((claim) => {
    if (claim.jurisdiction && claim.jurisdiction !== 'GLOBAL' && claim.jurisdiction !== input.entity.contactCountry) return [];
    if (claim.scope === 'sector' || claim.scope === 'person') return [];
    const value = scaleFromClaim(claim);
    return value == null ? [] : [{ claim, value }];
  }).sort((left, right) => right.value - left.value);
  const base = candidates[0];
  if (!base) return null;

  const cycleAssumption = {
    id: buildStableReportV2Id('asm', { kind: 'scenario_multipliers', multipliers }),
    label: 'Eventos por unidad al ano',
    value: multipliers.join(' / '),
    rationale: 'Escenarios configurados por el tenant para este producto.',
    editable: true,
  };
  const timeAssumption = {
    id: buildStableReportV2Id('asm', { kind: 'minutes_per_event', minutesPerEvent }),
    label: 'Minutos por evento',
    value: minutesPerEvent,
    rationale: 'Tiempo por evento configurado por el tenant para estimar carga operativa.',
    editable: true,
  };
  const ambiguousGeography = base.claim.scope === 'group' || !base.claim.jurisdiction || base.claim.jurisdiction === 'GLOBAL';
  const caveats = ambiguousGeography
    ? ['La cifra base es global; falta confirmar que parte corresponde a la operacion del contacto.']
    : [];
  const labels = ['Conservador', 'Base', 'Alto'];
  const model = VolumeModelV2Schema.parse({
    baseClaimId: base.claim.id,
    assumptions: [cycleAssumption, timeAssumption],
    scenarios: multipliers.map((multiplier, index) => {
      const eventsPerYear = base.value * multiplier;
      const eventsPerMonth = eventsPerYear / 12;
      return {
        label: labels[index],
        multiplier,
        eventsPerYear,
        eventsPerMonth,
        hoursPerMonth: eventsPerMonth * minutesPerEvent / 60,
      };
    }),
    baseScenarioIndex: 1,
    caveats,
  });
  const gap = ambiguousGeography ? {
    id: buildStableReportV2Id('gap', { field: 'volume.local_scale', country: input.entity.contactCountry }),
    section: 'volume' as const,
    requiredField: 'volume.local_scale',
    unknown: `Dotacion atribuible a la operacion ${input.entity.contactCountry}.`,
    howToFind: 'Confirmar la dotacion local en una fuente publica por pais o durante discovery.',
    source: `Busqueda de dotacion local para ${input.entity.companyName}.`,
  } : null;
  return { model, assumptions: model.assumptions, gap };
}
