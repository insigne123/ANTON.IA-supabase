export type AntoniaTargetOutcome = 'meetings' | 'positive_replies' | 'pipeline';

export type NormalizedMissionGoal = {
  targetOutcome: AntoniaTargetOutcome;
  targetMeetings: number;
  targetPositiveReplies: number;
  targetPipelineValue: number;
  targetTimelineDays: number;
  idealCustomerProfile: string;
  valueProposition: string;
};

export type MissionGoalProgress = {
  label: string;
  target: number;
  achieved: number;
  gap: number;
  progressPct: number;
  status: 'achieved' | 'on_track' | 'at_risk';
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value: unknown, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeText(value: unknown) {
  return String(value || '').trim();
}

export function normalizeMissionGoal(params?: any): NormalizedMissionGoal {
  const targetOutcome = String(params?.targetOutcome || 'meetings') as AntoniaTargetOutcome;
  return {
    targetOutcome: ['meetings', 'positive_replies', 'pipeline'].includes(targetOutcome) ? targetOutcome : 'meetings',
    targetMeetings: clamp(safeNumber(params?.targetMeetings, 5), 1, 500),
    targetPositiveReplies: clamp(safeNumber(params?.targetPositiveReplies, 12), 1, 1000),
    targetPipelineValue: clamp(safeNumber(params?.targetPipelineValue, 10000), 1, 1000000000),
    targetTimelineDays: clamp(safeNumber(params?.targetTimelineDays, 30), 1, 365),
    idealCustomerProfile: safeText(params?.idealCustomerProfile),
    valueProposition: safeText(params?.valueProposition),
  };
}

export function buildMissionGoalSummary(params?: any) {
  const goal = normalizeMissionGoal(params);
  const title = safeText(params?.jobTitle);
  const industry = safeText(params?.industry);
  const location = safeText(params?.location);
  const objectiveText = goal.targetOutcome === 'meetings'
    ? `agendar ${goal.targetMeetings} reuniones`
    : goal.targetOutcome === 'positive_replies'
      ? `generar ${goal.targetPositiveReplies} respuestas positivas`
      : `construir pipeline por ${goal.targetPipelineValue.toLocaleString('es-CL')}`;

  const audience = [title, industry].filter(Boolean).join(' en ');
  const parts = [
    `${objectiveText} en ${goal.targetTimelineDays} dias`,
    audience ? `con ${audience}` : '',
    location ? `para cuentas en ${location}` : '',
    goal.valueProposition ? `usando la propuesta: ${goal.valueProposition}` : '',
  ].filter(Boolean);

  return parts.join('. ');
}

export function computeMissionGoalProgress(params: any, actuals: {
  meetings?: number;
  positiveReplies?: number;
  pipelineValue?: number;
}): MissionGoalProgress {
  const goal = normalizeMissionGoal(params);

  if (goal.targetOutcome === 'positive_replies') {
    const achieved = safeNumber(actuals?.positiveReplies, 0);
    const target = goal.targetPositiveReplies;
    const progressPct = clamp(Math.round((achieved / Math.max(1, target)) * 100), 0, 1000);
    const gap = Math.max(0, target - achieved);
    return {
      label: 'Respuestas positivas',
      target,
      achieved,
      gap,
      progressPct,
      status: achieved >= target ? 'achieved' : achieved >= Math.max(1, Math.floor(target * 0.5)) ? 'on_track' : 'at_risk',
    };
  }

  if (goal.targetOutcome === 'pipeline') {
    const achieved = safeNumber(actuals?.pipelineValue, 0);
    const target = goal.targetPipelineValue;
    const progressPct = clamp(Math.round((achieved / Math.max(1, target)) * 100), 0, 1000);
    const gap = Math.max(0, target - achieved);
    return {
      label: 'Pipeline generado',
      target,
      achieved,
      gap,
      progressPct,
      status: achieved >= target ? 'achieved' : achieved >= Math.max(1, Math.floor(target * 0.4)) ? 'on_track' : 'at_risk',
    };
  }

  const achieved = safeNumber(actuals?.meetings, 0);
  const target = goal.targetMeetings;
  const progressPct = clamp(Math.round((achieved / Math.max(1, target)) * 100), 0, 1000);
  const gap = Math.max(0, target - achieved);
  return {
    label: 'Reuniones',
    target,
    achieved,
    gap,
    progressPct,
    status: achieved >= target ? 'achieved' : achieved >= Math.max(1, Math.floor(target * 0.4)) ? 'on_track' : 'at_risk',
  };
}

export function shortMissionGoalLabel(params?: any) {
  const goal = normalizeMissionGoal(params);
  if (goal.targetOutcome === 'positive_replies') {
    return `${goal.targetPositiveReplies} replies / ${goal.targetTimelineDays}d`;
  }
  if (goal.targetOutcome === 'pipeline') {
    return `${goal.targetPipelineValue.toLocaleString('es-CL')} pipeline / ${goal.targetTimelineDays}d`;
  }
  return `${goal.targetMeetings} meetings / ${goal.targetTimelineDays}d`;
}
