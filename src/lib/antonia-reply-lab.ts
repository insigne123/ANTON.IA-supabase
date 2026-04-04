import { decideAutonomousReplyAction, resolveReplyAutopilotConfig, type AntoniaReplyDecisionAction } from '@/lib/antonia-reply-policy';
import type { AntoniaConfig } from '@/lib/types';

type ScenarioIntent = 'meeting_request' | 'positive' | 'negative' | 'unsubscribe' | 'auto_reply' | 'neutral' | 'unknown' | 'delivery_failure';

export type ReplySafetyScenario = {
  id: string;
  label: string;
  replyText: string;
  classification: {
    intent: ScenarioIntent;
    confidence: number;
  };
  turnCount: number;
  expectedAction: AntoniaReplyDecisionAction;
};

export type ReplySafetyScenarioResult = {
  id: string;
  label: string;
  expectedAction: AntoniaReplyDecisionAction;
  actualAction: AntoniaReplyDecisionAction;
  recommendedAction: AntoniaReplyDecisionAction;
  passed: boolean;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskFlags: Record<string, boolean>;
};

export type ReplySafetyLabRun = {
  config: ReturnType<typeof resolveReplyAutopilotConfig>;
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    safeToPromote: boolean;
  };
  results: ReplySafetyScenarioResult[];
};

export const DEFAULT_REPLY_SAFETY_SCENARIOS: ReplySafetyScenario[] = [
  {
    id: 'meeting-request-booking',
    label: 'Lead pide una reunion directa',
    replyText: 'Gracias. Me interesa conversar. Tienes link para agendar una reunion esta semana?',
    classification: { intent: 'meeting_request', confidence: 0.97 },
    turnCount: 0,
    expectedAction: 'send',
  },
  {
    id: 'positive-short',
    label: 'Reply positivo simple',
    replyText: 'Suena bien. Feliz de conversar si te parece.',
    classification: { intent: 'positive', confidence: 0.91 },
    turnCount: 0,
    expectedAction: 'send',
  },
  {
    id: 'pricing-question',
    label: 'Pregunta por pricing',
    replyText: 'Interesante. Antes de avanzar, cual es el precio y como estructuran la tarifa?',
    classification: { intent: 'positive', confidence: 0.88 },
    turnCount: 0,
    expectedAction: 'review',
  },
  {
    id: 'security-question',
    label: 'Pregunta de seguridad/compliance',
    replyText: 'Pueden compartir como manejan seguridad de datos y si tienen SOC2 o ISO 27001?',
    classification: { intent: 'neutral', confidence: 0.89 },
    turnCount: 0,
    expectedAction: 'review',
  },
  {
    id: 'integration-question',
    label: 'Pregunta de integracion tecnica',
    replyText: 'Nos serviria entender si esto se integra con Salesforce y nuestro ERP.',
    classification: { intent: 'neutral', confidence: 0.9 },
    turnCount: 0,
    expectedAction: 'review',
  },
  {
    id: 'unsubscribe',
    label: 'Unsubscribe explicito',
    replyText: 'Por favor no me contacten mas y eliminenme de la lista.',
    classification: { intent: 'unsubscribe', confidence: 0.99 },
    turnCount: 0,
    expectedAction: 'stop',
  },
  {
    id: 'negative',
    label: 'No interesado',
    replyText: 'No nos interesa por ahora, gracias.',
    classification: { intent: 'negative', confidence: 0.96 },
    turnCount: 0,
    expectedAction: 'stop',
  },
  {
    id: 'delivery-failure',
    label: 'Falla de entrega detectada',
    replyText: '550 5.1.1 user unknown',
    classification: { intent: 'delivery_failure', confidence: 0.99 },
    turnCount: 0,
    expectedAction: 'stop',
  },
  {
    id: 'out-of-office',
    label: 'Auto reply fuera de oficina',
    replyText: 'Respuesta automatica: estare fuera de oficina hasta el lunes.',
    classification: { intent: 'auto_reply', confidence: 0.94 },
    turnCount: 0,
    expectedAction: 'draft',
  },
  {
    id: 'attachment-request',
    label: 'Pide brochure o deck',
    replyText: 'Me interesa. Puedes mandarme un brochure o una presentacion primero?',
    classification: { intent: 'positive', confidence: 0.86 },
    turnCount: 0,
    expectedAction: 'draft',
  },
  {
    id: 'late-turn-review',
    label: 'Demasiados turnos automaticos',
    replyText: 'Perfecto, pero antes necesito entender el alcance exacto y los siguientes pasos.',
    classification: { intent: 'positive', confidence: 0.84 },
    turnCount: 3,
    expectedAction: 'review',
  },
  {
    id: 'ambiguous-neutral',
    label: 'Reply ambiguo',
    replyText: 'Suena interesante. Manda mas info y vemos.',
    classification: { intent: 'neutral', confidence: 0.7 },
    turnCount: 0,
    expectedAction: 'review',
  },
];

export function buildDefaultReplySafetyConfig(): Partial<AntoniaConfig> {
  return {
    replyAutopilotEnabled: true,
    replyAutopilotMode: 'auto_safe',
    replyApprovalMode: 'high_risk_only',
    replyMaxAutoTurns: 2,
    autoSendBookingReplies: true,
    allowReplyAttachments: false,
    bookingLink: 'https://calendly.com/demo/reunion',
    meetingInstructions: 'Ofrece una reunion breve y confirma asistentes.',
  };
}

export function runReplySafetyLab(params?: {
  config?: Partial<AntoniaConfig> | null;
  scenarios?: ReplySafetyScenario[];
}): ReplySafetyLabRun {
  const rawConfig = params?.config || buildDefaultReplySafetyConfig();
  const config = resolveReplyAutopilotConfig(rawConfig);
  const scenarios = params?.scenarios || DEFAULT_REPLY_SAFETY_SCENARIOS;

  const results = scenarios.map((scenario) => {
    const decision = decideAutonomousReplyAction({
      config: rawConfig,
      classification: scenario.classification,
      rawReply: scenario.replyText,
      turnCount: scenario.turnCount,
    });

    const passed = decision.action === scenario.expectedAction;
    return {
      id: scenario.id,
      label: scenario.label,
      expectedAction: scenario.expectedAction,
      actualAction: decision.action,
      recommendedAction: decision.recommendedAction,
      passed,
      reason: decision.reason,
      severity: decision.severity,
      riskFlags: decision.riskFlags,
    } satisfies ReplySafetyScenarioResult;
  });

  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return {
    config,
    summary: {
      total,
      passed,
      failed,
      passRate,
      safeToPromote: passRate >= 90 && failed === 0,
    },
    results,
  };
}
