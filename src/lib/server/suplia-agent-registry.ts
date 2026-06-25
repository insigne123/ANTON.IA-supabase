import { z } from 'genkit';

import { getOpenAiModelForTier, getOpenAiModelsForTier, type OpenAiModelTier } from '@/ai/model-router';
import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import type { AuthContext } from '@/lib/server/auth-utils';
import { buildSupliaContext } from '@/lib/server/suplia-context';
import { buildOpenAiTelemetry } from '@/lib/server/suplia-observability';
import { runSupliaTool } from '@/lib/server/suplia-tool-runner';
import { buildGmailMailboxQuery, extractGmailMailboxTopic } from '@/lib/gmail-mailbox-helpers';
import type { SupliaArtifactType } from '@/lib/suplia/types';

export type SupliaAgentName =
  | 'planner'
  | 'icp-strategist'
  | 'prospector'
  | 'company-scorer'
  | 'lead-scorer'
  | 'enricher'
  | 'copywriter'
  | 'compliance'
  | 'campaign-operator'
  | 'reply-analyst'
  | 'thread-responder'
  | 'gmail-analyst'
  | 'crm-operator'
  | 'memory-agent'
  | 'reporter';

export type SupliaAgentArtifact = {
  type: SupliaArtifactType;
  title: string;
  content?: string | null;
  data?: Record<string, unknown>;
};

export type SupliaAgentPendingAction = {
  actionType: string;
  title: string;
  description?: string | null;
  payload: Record<string, unknown>;
};

export type SupliaAgentResult = {
  status: 'completed' | 'waiting_approval';
  output: Record<string, unknown>;
  reasoningSummary?: string | null;
  artifacts?: SupliaAgentArtifact[];
  pendingActions?: SupliaAgentPendingAction[];
  modelTier?: OpenAiModelTier | null;
  modelName?: string | null;
  tokenUsage?: Record<string, unknown> | null;
  estimatedCost?: number | null;
};

export type SupliaAgentExecution = {
  auth: AuthContext;
  job: any;
  step: any;
  agentRunId?: string | null;
  previousSteps: any[];
};

type SupliaAgentDefinition = {
  name: SupliaAgentName;
  title: string;
  modelTier: OpenAiModelTier;
  handler: (execution: SupliaAgentExecution) => Promise<SupliaAgentResult>;
};

const PlannerSchema = z.object({
  title: z.string().default('Plan operativo'),
  summary: z.string(),
  jobType: z.string().default('prospecting_campaign'),
  steps: z.array(z.object({
    key: z.string(),
    title: z.string(),
    description: z.string(),
    agentName: z.string(),
  })).default([]),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

const IcpStrategySchema = z.object({
  summary: z.string(),
  segments: z.array(z.object({
    name: z.string(),
    industries: z.array(z.string()).default([]),
    companySizes: z.array(z.string()).default([]),
    geographies: z.array(z.string()).default([]),
    buyingSignals: z.array(z.string()).default([]),
    decisionRoles: z.array(z.string()).default([]),
    influencerRoles: z.array(z.string()).default([]),
    messageAngle: z.string(),
    exclusions: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
  })).default([]),
  searchPlan: z.object({
    provider: z.enum(['apollo', 'pdl', 'auto']).default('apollo'),
    companyQueries: z.array(z.string()).default([]),
    peopleTitles: z.array(z.string()).default([]),
    locations: z.array(z.string()).default([]),
    maxCompanies: z.number().default(8),
    maxPeoplePerCompany: z.number().default(3),
    estimatedCreditUse: z.object({
      companySearches: z.number().default(1),
      peopleSearchPages: z.number().default(1),
    }).default({ companySearches: 1, peopleSearchPages: 1 }),
  }),
  reusableMemoryCandidates: z.array(z.string()).default([]),
});

function safeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstSentence(value: string, fallback: string) {
  const clean = safeText(value);
  if (!clean) return fallback;
  const sentence = clean.split(/[.!?]/)[0]?.trim() || clean;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

function isVagueSearchCriterion(value: string) {
  const normalized = safeText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!normalized) return true;
  return /^(si|si adelante|adelante|ok|okay|dale|continua|continuar|apruebo|aprobado|hazlo|vamos|perfecto|de acuerdo)( por favor| nomas| no mas)?$/.test(normalized);
}

function findPreviousOutput(previousSteps: any[], stepKey: string) {
  return previousSteps.find((step) => step.step_key === stepKey)?.output_payload || {};
}

function findPreviousResult(previousSteps: any[], stepKey: string) {
  const output = findPreviousOutput(previousSteps, stepKey);
  return (output as any)?.result || output || {};
}

function findStrategy(previousSteps: any[], goal: string) {
  const output = findPreviousOutput(previousSteps, 'icp_strategy');
  return (output as any)?.strategy || fallbackIcp(goal);
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.filter(Boolean) as any[] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asTextList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  const text = String(value || '').trim();
  return text ? text.split(/[;,]/g).map((item) => item.trim()).filter(Boolean) : [];
}

function leadEmail(lead: any) {
  return String(lead?.email || lead?.sourcePayload?.email || '').trim().toLowerCase();
}

function leadName(lead: any) {
  return String(lead?.fullName || lead?.full_name || lead?.name || lead?.sourcePayload?.fullName || lead?.sourcePayload?.name || 'Contacto').trim();
}

function leadCompany(lead: any) {
  return String(lead?.companyName || lead?.company || lead?.sourcePayload?.companyName || lead?.sourcePayload?.company || 'Empresa').trim();
}

async function runInternalTool(execution: SupliaAgentExecution, toolName: string, input: Record<string, unknown>, modelTier: OpenAiModelTier = 'orchestrator') {
  const { output } = await runSupliaTool({
    auth: execution.auth,
    conversationId: execution.job.conversation_id,
    jobId: execution.job.id,
    stepId: execution.step.id,
    agentRunId: execution.agentRunId || null,
    toolName,
    input,
    modelTier,
  });
  return output;
}

function stringifyList(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) return 'No definido';
  return items.map((item) => String(item || '').trim()).filter(Boolean).join(', ') || 'No definido';
}

function formatPlannerContent(plan: z.infer<typeof PlannerSchema>) {
  const steps = plan.steps.length > 0
    ? plan.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.description}`).join('\n')
    : '1. Definir ICP\n2. Preparar busqueda aprobable\n3. Mostrar resultados y siguientes pasos';

  const risks = plan.risks.length > 0 ? `\n\nRiesgos:\n${plan.risks.map((risk) => `- ${risk}`).join('\n')}` : '';
  return `${plan.summary}\n\nPasos:\n${steps}${risks}`;
}

function formatIcpContent(strategy: z.infer<typeof IcpStrategySchema>) {
  const segments = strategy.segments.map((segment, index) => [
    `${index + 1}. ${segment.name}`,
    `Industrias: ${stringifyList(segment.industries)}`,
    `Tamano: ${stringifyList(segment.companySizes)}`,
    `Geografias: ${stringifyList(segment.geographies)}`,
    `Roles decisores: ${stringifyList(segment.decisionRoles)}`,
    `Senales: ${stringifyList(segment.buyingSignals)}`,
    `Mensaje: ${segment.messageAngle}`,
  ].join('\n')).join('\n\n');

  const queries = strategy.searchPlan.companyQueries.join(', ') || 'No definido';
  const roles = strategy.searchPlan.peopleTitles.join(', ') || 'No definido';
  return `${strategy.summary}\n\nSegmentos:\n${segments || 'No definido'}\n\nBusqueda propuesta:\nEmpresas: ${queries}\nRoles: ${roles}\nMax empresas: ${strategy.searchPlan.maxCompanies}`;
}

function fallbackPlan(goal: string): z.infer<typeof PlannerSchema> {
  return {
    title: firstSentence(goal, 'Plan operativo'),
    summary: `Voy a convertir el objetivo en un flujo seguro: primero estrategia, luego busqueda aprobable y despues resultados trazables.`,
    jobType: 'prospecting_campaign',
    steps: [
      { key: 'planner', title: 'Plan operativo', description: 'Ordenar el objetivo y decidir el camino seguro.', agentName: 'planner' },
      { key: 'plan_approval', title: 'Aprobacion del plan', description: 'Pedir aprobacion humana antes de continuar con subagentes.', agentName: 'planner' },
      { key: 'icp_strategy', title: 'ICP y search plan', description: 'Definir segmentos, roles y criterios antes de consumir creditos.', agentName: 'icp-strategist' },
      { key: 'prospector_approval', title: 'Aprobacion de busqueda', description: 'Preparar una busqueda externa para aprobacion humana.', agentName: 'prospector' },
    ],
    assumptions: ['El usuario quiere preparar prospeccion o campana sin ejecutar acciones sensibles automaticamente.'],
    risks: ['Las busquedas Apollo/PDL pueden consumir creditos y requieren aprobacion.'],
  };
}

function fallbackIcp(goal: string): z.infer<typeof IcpStrategySchema> {
  const query = firstSentence(goal, 'empresas objetivo');
  return {
    summary: 'Estrategia inicial basada en el objetivo del usuario. Debe revisarse antes de consumir creditos externos.',
    segments: [{
      name: query,
      industries: [query],
      companySizes: ['10-200 empleados', '200-1000 empleados'],
      geographies: ['Mercado indicado por el usuario o pais principal de operacion'],
      buyingSignals: ['Necesidad operativa explicita', 'Crecimiento o digitalizacion visible', 'Rol con responsabilidad sobre el problema'],
      decisionRoles: ['CEO', 'Founder', 'COO', 'Head of Operations', 'Commercial Director'],
      influencerRoles: ['Operations Manager', 'Sales Manager', 'Project Manager'],
      messageAngle: 'Conectar el problema operativo con una mejora concreta y facil de evaluar.',
      exclusions: ['Dominios bloqueados', 'Contactos sin email verificable', 'Empresas ya contactadas recientemente'],
      risks: ['ICP amplio; conviene validar los primeros resultados antes de escalar.'],
    }],
    searchPlan: {
      provider: 'apollo',
      companyQueries: [query],
      peopleTitles: ['CEO', 'Founder', 'COO', 'Head of Operations', 'Commercial Director'],
      locations: [],
      maxCompanies: 8,
      maxPeoplePerCompany: 3,
      estimatedCreditUse: { companySearches: 1, peopleSearchPages: 1 },
    },
    reusableMemoryCandidates: [],
  };
}

async function runPlanner(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  if (execution.step.step_key === 'plan_approval') {
    const plannerOutput = findPreviousOutput(execution.previousSteps, 'planner');
    const plan = (plannerOutput as any)?.plan || fallbackPlan(safeText(execution.job.goal));
    const planSteps = Array.isArray(plan.steps) ? plan.steps : [];
    const summary = safeText(plan.summary) || 'Plan operativo preparado para revision.';

    return {
      status: 'waiting_approval',
      output: { waitingFor: 'workflow.approve_plan', plan },
      reasoningSummary: 'El plan queda esperando aprobacion humana antes de continuar.',
      pendingActions: [{
        actionType: 'workflow.approve_plan',
        title: 'Aprobar plan de trabajo',
        description: `${summary} Si apruebas, continuo con ICP y criterios de busqueda sin consumir creditos externos todavia.`,
        payload: {
          goal: safeText(execution.job.goal),
          planTitle: safeText(plan.title) || 'Plan operativo',
          planSummary: summary,
          steps: planSteps.map((step: any, index: number) => ({
            order: index + 1,
            title: safeText(step.title || step.key) || `Paso ${index + 1}`,
            description: safeText(step.description),
          })),
          risks: Array.isArray(plan.risks) ? plan.risks : [],
          source: 'suplia_plan_approval',
        },
      }],
    };
  }

  const context = await buildSupliaContext(execution.auth);
  const goal = safeText(execution.job.goal);
  const prompt = `
Eres el subagente planner de SUPL.IA. Crea un plan operativo breve, verificable y seguro.

Reglas:
- No ejecutes herramientas externas.
- No consumas creditos.
- No prometas resultados no obtenidos.
- Mantén el plan orientado a aprobaciones humanas para acciones sensibles.
- Devuelve JSON estricto.

Objetivo del usuario:
${goal}

Contexto de app:
${JSON.stringify(context).slice(0, 5000)}
`;

  let plan: z.infer<typeof PlannerSchema>;
  let telemetry: ReturnType<typeof buildOpenAiTelemetry> | null = null;
  try {
    const generated = await generateStructuredWithTelemetry({
      prompt,
      schema: PlannerSchema,
      temperature: 0.2,
      openAiModels: getOpenAiModelsForTier('reasoning'),
    });
    plan = generated.data;
    telemetry = buildOpenAiTelemetry({
      modelTier: 'reasoning',
      modelName: generated.telemetry.modelName,
      usage: generated.telemetry.usage,
      durationMs: generated.telemetry.durationMs,
    });
  } catch (error) {
    console.warn('[SUPLIA/planner] fallback:', error);
    plan = fallbackPlan(goal);
  }

  return {
    status: 'completed',
    output: { plan },
    reasoningSummary: plan.summary,
    modelName: telemetry?.modelName || null,
    tokenUsage: telemetry?.tokenUsage || null,
    estimatedCost: telemetry?.estimatedCost || null,
    artifacts: [{
      type: 'plan',
      title: plan.title || 'Plan operativo',
      content: formatPlannerContent(plan),
      data: { plan },
    }],
  };
}

async function runIcpStrategist(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const context = await buildSupliaContext(execution.auth);
  const goal = safeText(execution.job.goal);
  const previousPlannerOutput = findPreviousOutput(execution.previousSteps, 'planner');
  const plannerOutput = Object.keys(previousPlannerOutput).length > 0
    ? previousPlannerOutput
    : ((execution.job.input_payload || {}).approvedPlan || {});
  const prompt = `
Eres el subagente icp-strategist de SUPL.IA. Define el ICP y un search plan antes de consumir creditos.

Reglas:
- No ejecutes busquedas externas.
- Propón segmentos, roles y criterios concretos.
- Si faltan datos, usa supuestos explicitamente conservadores.
- Excluye contactos riesgosos: unsubscribes, dominios bloqueados y contactados recientes.
- Devuelve JSON estricto.

Objetivo del usuario:
${goal}

Plan previo:
${JSON.stringify(plannerOutput).slice(0, 5000)}

Contexto de app:
${JSON.stringify(context).slice(0, 5000)}
`;

  let strategy: z.infer<typeof IcpStrategySchema>;
  let telemetry: ReturnType<typeof buildOpenAiTelemetry> | null = null;
  try {
    const generated = await generateStructuredWithTelemetry({
      prompt,
      schema: IcpStrategySchema,
      temperature: 0.2,
      openAiModels: getOpenAiModelsForTier('reasoning'),
    });
    strategy = generated.data;
    telemetry = buildOpenAiTelemetry({
      modelTier: 'reasoning',
      modelName: generated.telemetry.modelName,
      usage: generated.telemetry.usage,
      durationMs: generated.telemetry.durationMs,
    });
  } catch (error) {
    console.warn('[SUPLIA/icp-strategist] fallback:', error);
    strategy = fallbackIcp(goal);
  }

  const maxCompanies = Math.max(1, Math.min(Math.floor(Number(strategy.searchPlan.maxCompanies || 8)), 25));
  strategy.searchPlan.maxCompanies = maxCompanies;

  return {
    status: 'completed',
    output: { strategy },
    reasoningSummary: strategy.summary,
    modelName: telemetry?.modelName || null,
    tokenUsage: telemetry?.tokenUsage || null,
    estimatedCost: telemetry?.estimatedCost || null,
    artifacts: [
      {
        type: 'icp_strategy',
        title: 'ICP propuesto',
        content: formatIcpContent(strategy),
        data: { strategy },
      },
      {
        type: 'search_plan',
        title: 'Search plan aprobable',
        content: `Proveedor sugerido: ${strategy.searchPlan.provider}\nEmpresas: ${strategy.searchPlan.companyQueries.join(', ') || 'No definido'}\nRoles: ${strategy.searchPlan.peopleTitles.join(', ') || 'No definido'}\nMax empresas: ${strategy.searchPlan.maxCompanies}`,
        data: { searchPlan: strategy.searchPlan },
      },
    ],
  };
}

async function runProspector(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const goal = safeText(execution.job.goal);
  const strategy = findStrategy(execution.previousSteps, goal);
  const searchPlan = strategy.searchPlan || fallbackIcp(goal).searchPlan;
  const isPeopleApproval = execution.step.step_key === 'people_search_approval';

  if (isPeopleApproval) {
    const companyScoresOutput = findPreviousOutput(execution.previousSteps, 'company_scoring');
    const topCompanies = asArray((companyScoresOutput as any)?.topCompanies || (companyScoresOutput as any)?.items).slice(0, 8);
    const companyNames = topCompanies.map((company) => safeText(company.companyName || company.name)).filter(Boolean);
    const domains = topCompanies.map((company) => safeText(company.domain || company.primary_domain)).filter(Boolean);
    const peopleTitles = asTextList(searchPlan.peopleTitles || searchPlan.personTitles).slice(0, 10);

    if (companyNames.length === 0 && domains.length === 0) {
      return {
        status: 'completed',
        output: { skipped: true, reason: 'no_companies_to_search_people' },
        reasoningSummary: 'No hay empresas suficientes para preparar busqueda de personas.',
      };
    }

    const estimatedCreditUse = asRecord(searchPlan.estimatedCreditUse);

    return {
      status: 'waiting_approval',
      output: {
        waitingFor: 'prospecting.search_people',
        searchPlan: { provider: searchPlan.provider || 'auto', companyNames, domains, peopleTitles, estimatedCreditUse },
      },
      reasoningSummary: 'La busqueda de personas queda preparada como aprobacion porque puede consumir creditos.',
      pendingActions: [{
        actionType: 'prospecting.search_people',
        title: 'Buscar decisores en empresas priorizadas',
        description: `Buscar hasta ${Math.min(25, Math.max(5, companyNames.length * 3))} contactos en ${companyNames.length || domains.length} empresa${companyNames.length === 1 || domains.length === 1 ? '' : 's'} priorizada${companyNames.length === 1 || domains.length === 1 ? '' : 's'}. Roles objetivo: ${peopleTitles.join(', ') || 'decisores comerciales y operativos'}. Puede consumir creditos externos y no enviara correos.`,
        payload: {
          companyNames,
          domains,
          personTitles: peopleTitles.length ? peopleTitles : ['CEO', 'Founder', 'COO', 'Head of Operations', 'Commercial Director'],
          personLocations: asTextList(searchPlan.locations),
          perPage: 25,
          maxPages: 1,
          provider: searchPlan.provider === 'pdl' ? 'pdl' : searchPlan.provider === 'apollo' ? 'apollo' : undefined,
          estimatedCreditUse,
          source: 'suplia_multiagent_job',
        },
      }],
    };
  }

  const companyQueries = Array.isArray(searchPlan.companyQueries) ? searchPlan.companyQueries.map(safeText).filter(Boolean) : [];
  const peopleTitles = Array.isArray(searchPlan.peopleTitles) ? searchPlan.peopleTitles.map(safeText).filter(Boolean) : [];
  const locations = Array.isArray(searchPlan.locations) ? searchPlan.locations.map(safeText).filter(Boolean) : [];
  const companyName = companyQueries[0] || firstSentence(goal, 'empresas objetivo');
  const provider = searchPlan.provider === 'pdl' ? 'pdl' : searchPlan.provider === 'apollo' ? 'apollo' : undefined;
  const perPage = Math.max(1, Math.min(Math.floor(Number(searchPlan.maxCompanies || 8)), 25));
  const estimatedCreditUse = asRecord(searchPlan.estimatedCreditUse);

  if (companyQueries.length === 0 || isVagueSearchCriterion(companyName)) {
    return {
      status: 'completed',
      output: {
        needsClarification: true,
        reason: 'vague_search_criterion',
        searchPlan: { provider: provider || 'auto', companyQueries, peopleTitles, locations, maxCompanies: perPage, estimatedCreditUse },
      },
      reasoningSummary: 'Necesito un criterio mas especifico antes de preparar una busqueda externa. Indica industria, tipo de empresa, ubicacion o tamano objetivo.',
    };
  }

  return {
    status: 'waiting_approval',
    output: {
      waitingFor: 'prospecting.search_companies',
      searchPlan: {
        provider: provider || 'auto',
        companyQueries,
        peopleTitles,
        locations,
        maxCompanies: perPage,
        estimatedCreditUse,
      },
    },
    reasoningSummary: 'La busqueda externa queda preparada como aprobacion porque puede consumir creditos.',
    pendingActions: [{
      actionType: 'prospecting.search_companies',
      title: 'Buscar empresas con proveedor externo',
      description: `Buscar hasta ${perPage} empresas para: ${companyQueries.join(', ') || companyName}. Proveedor sugerido: ${provider || 'automatico'}. Roles para la etapa siguiente: ${peopleTitles.join(', ') || 'decisores comerciales y operativos'}. Esta busqueda puede consumir creditos y no enviara correos ni modificara CRM.`,
      payload: {
        companyName,
        query: companyName,
        perPage,
        provider,
        estimatedCreditUse,
        searchPlan: {
          companyQueries,
          peopleTitles,
          locations,
          estimatedCreditUse,
        },
        source: 'suplia_multiagent_job',
      },
    }],
  };
}

async function runCompanyScorer(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const goal = safeText(execution.job.goal);
  const strategy = findStrategy(execution.previousSteps, goal);
  const searchResult = findPreviousResult(execution.previousSteps, 'prospector_approval');
  const candidates = asArray((searchResult as any).candidates);

  const deduped = await runInternalTool(execution, 'prospecting.dedupe_against_crm', { companies: candidates }, 'fast');
  const scored = await runInternalTool(execution, 'prospecting.score_companies', {
    companies: asArray((deduped as any).companies),
    strategy,
    limit: 10,
  }, 'fast');
  const topCompanies = asArray((scored as any).topCompanies);
  const content = topCompanies.length
    ? topCompanies.map((company: any, index) => `${index + 1}. ${company.companyName} (${company.score}/100)${company.domain ? ` - ${company.domain}` : ''}\n${asArray(company.reasons).join('; ')}`).join('\n\n')
    : 'No hay empresas suficientes para priorizar.';

  return {
    status: 'completed',
    output: { ...scored, dedupeSummary: (deduped as any).summary, topCompanies },
    reasoningSummary: `Se puntuaron ${topCompanies.length} empresas contra el ICP.`,
    artifacts: [{
      type: 'company_shortlist',
      title: `Empresas priorizadas (${topCompanies.length})`,
      content,
      data: { scored, dedupe: deduped },
    }],
  };
}

async function runLeadScorer(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const goal = safeText(execution.job.goal);
  const strategy = findStrategy(execution.previousSteps, goal);
  const peopleResult = findPreviousResult(execution.previousSteps, 'people_search_approval');
  const leads = asArray((peopleResult as any).leads);

  const deduped = await runInternalTool(execution, 'prospecting.dedupe_against_crm', { leads }, 'fast');
  const scored = await runInternalTool(execution, 'prospecting.score_people', {
    leads: asArray((deduped as any).leads),
    strategy,
    limit: 15,
  }, 'orchestrator');
  const topLeads = asArray((scored as any).topLeads);
  const content = topLeads.length
    ? topLeads.map((lead: any, index) => `${index + 1}. ${lead.fullName} - ${lead.title || 'Rol no definido'} en ${lead.companyName || 'Empresa'} (${lead.score}/100)${lead.email ? ` - ${lead.email}` : ''}\n${asArray(lead.reasons).join('; ')}${asArray(lead.risks).length ? `\nRiesgos: ${asArray(lead.risks).join('; ')}` : ''}`).join('\n\n')
    : 'No hay leads suficientes para priorizar.';

  return {
    status: 'completed',
    output: { ...scored, dedupeSummary: (deduped as any).summary, topLeads },
    reasoningSummary: `Se puntuaron ${topLeads.length} leads contra el ICP y guardrails de contacto.`,
    artifacts: [{
      type: 'person_shortlist',
      title: `Leads priorizados (${topLeads.length})`,
      content,
      data: { scored, dedupe: deduped },
    }],
  };
}

async function runEnricher(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const leadScoresOutput = findPreviousOutput(execution.previousSteps, 'lead_scoring');
  const topLeads = asArray((leadScoresOutput as any).topLeads || (leadScoresOutput as any).items)
    .filter((lead) => Number(lead.score || 0) >= 45)
    .slice(0, 10);

  if (topLeads.length === 0) {
    return {
      status: 'completed',
      output: { skipped: true, reason: 'no_leads_for_enrichment' },
      reasoningSummary: 'No hay leads con score suficiente para proponer enrichment.',
    };
  }

  return {
    status: 'waiting_approval',
    output: { waitingFor: 'lead.enrich_batch', leads: topLeads },
    reasoningSummary: 'El enrichment queda preparado como aprobacion porque puede consumir creditos.',
    pendingActions: [{
      actionType: 'lead.enrich_batch',
      title: `Enriquecer ${topLeads.length} leads priorizados`,
      description: `Completar datos de ${topLeads.length} lead${topLeads.length === 1 ? '' : 's'} con proveedor externo. Puede consumir creditos.`,
      payload: {
        leads: topLeads.map((lead) => lead.sourcePayload || lead),
        provider: 'pdl',
        limit: topLeads.length,
        source: 'suplia_multiagent_job',
      },
    }],
  };
}

async function runCopywriter(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const goal = safeText(execution.job.goal);
  const enrichmentResult = findPreviousResult(execution.previousSteps, 'enrichment_approval');
  const fallbackLeads = asArray((findPreviousOutput(execution.previousSteps, 'lead_scoring') as any).topLeads);
  const leads = asArray((enrichmentResult as any).items).length ? asArray((enrichmentResult as any).items) : fallbackLeads;
  const previews = await runInternalTool(execution, 'email.bulk_variant_preview', {
    leads: leads.slice(0, 8),
    offerSummary: goal,
    cta: 'te parece si lo revisamos 15 minutos esta semana?',
    limit: 8,
  }, 'balanced');
  const samples = asArray((previews as any).previews);
  const content = samples.length
    ? samples.map((preview: any, index) => `${index + 1}. ${preview.recipientName || 'Contacto'} - ${preview.company || 'Empresa'}\nPara: ${preview.to || 'Sin email'}\nAsunto: ${preview.subject}\n\n${preview.textBody}`).join('\n\n---\n\n')
    : 'No se pudieron generar previews porque no hay leads disponibles.';

  return {
    status: 'completed',
    output: { previews: samples, count: samples.length },
    reasoningSummary: `Se generaron ${samples.length} borradores personalizados sin enviar correos.`,
    artifacts: [{
      type: 'personalized_email_draft',
      title: `Borradores personalizados (${samples.length})`,
      content,
      data: { previews: samples },
    }],
  };
}

async function runCompliance(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const copyOutput = findPreviousOutput(execution.previousSteps, 'copywriting');
  const previews = asArray((copyOutput as any).previews);
  const preflight = await runInternalTool(execution, 'compliance.preflight_campaign', {
    messages: previews,
    audienceCount: previews.length,
    sampleLimit: previews.length,
  }, 'orchestrator');

  const status = String((preflight as any).status || 'review');
  const content = `Estado: ${status}\nMuestras: ${(preflight as any).sampleCount || 0}\nBloqueos: ${(preflight as any).blockedCount || 0}\nWarnings: ${(preflight as any).reviewCount || 0}`;

  return {
    status: 'completed',
    output: { preflight },
    reasoningSummary: `Preflight completado con estado ${status}.`,
    artifacts: [
      {
        type: 'risk_report',
        title: `Preflight compliance: ${status}`,
        content,
        data: { preflight },
      },
      {
        type: 'campaign_preview',
        title: 'Preview de campana listo para revision',
        content: 'La campana esta en preview. Guardar, lanzar o enviar requiere aprobaciones separadas.',
        data: { previews, preflight },
      },
    ],
  };
}

function previewToCampaignStep(preview: any, index: number) {
  return {
    name: `Paso ${index + 1}`,
    offsetDays: index === 0 ? 0 : index * 3,
    subject: safeText(preview?.subject) || `Seguimiento ${index + 1}`,
    bodyHtml: safeText(preview?.htmlBody) || safeText(preview?.textBody).split(/\n{2,}/).map((paragraph) => `<p>${paragraph}</p>`).join(''),
  };
}

async function runCampaignOperator(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const goal = safeText(execution.job.goal);

  if (execution.step.step_key === 'campaign_launch_approval') {
    const draftResult = findPreviousResult(execution.previousSteps, 'campaign_draft_approval');
    const complianceOutput = findPreviousOutput(execution.previousSteps, 'compliance_preflight');
    const campaignId = safeText((draftResult as any).campaignId || (draftResult as any).campaign?.id);
    const preflightStatus = safeText((complianceOutput as any)?.preflight?.status || 'review') || 'review';

    if (!campaignId) {
      return {
        status: 'completed',
        output: { skipped: true, reason: 'missing_campaign_id' },
        reasoningSummary: 'No hay campana guardada para preparar lanzamiento.',
      };
    }

    return {
      status: 'waiting_approval',
      output: { waitingFor: 'campaign.launch', campaignId, preflightStatus },
      reasoningSummary: 'La campana quedo lista para una aprobacion fuerte de lanzamiento.',
      pendingActions: [{
        actionType: 'campaign.launch',
        title: 'Lanzar campana guardada',
        description: 'Activar la campana permite que el cron procese envios segun guardrails. Requiere aprobacion fuerte.',
        payload: { campaignId, preflightStatus, source: 'suplia_multiagent_job' },
      }],
    };
  }

  const copyOutput = findPreviousOutput(execution.previousSteps, 'copywriting');
  const complianceOutput = findPreviousOutput(execution.previousSteps, 'compliance_preflight');
  const previews = asArray((copyOutput as any).previews).slice(0, 5);
  const preflightStatus = safeText((complianceOutput as any)?.preflight?.status || 'review') || 'review';

  if (preflightStatus === 'blocked') {
    return {
      status: 'completed',
      output: { skipped: true, reason: 'preflight_blocked', preflightStatus },
      reasoningSummary: 'No se propone guardar campana porque el preflight bloqueo la muestra.',
    };
  }

  const steps = previews
    .map(previewToCampaignStep)
    .filter((step) => step.subject && step.bodyHtml);

  if (steps.length === 0) {
    return {
      status: 'completed',
      output: { skipped: true, reason: 'missing_campaign_steps' },
      reasoningSummary: 'No hay borradores suficientes para guardar una campana.',
    };
  }

  return {
    status: 'waiting_approval',
    output: { waitingFor: 'campaign.create_draft', steps, preflightStatus },
    reasoningSummary: 'La campana queda preparada como borrador pausado para aprobacion humana.',
    pendingActions: [{
      actionType: 'campaign.create_draft',
      title: 'Guardar campana pausada',
      description: `Guardar ${steps.length} paso${steps.length === 1 ? '' : 's'} como borrador pausado. No envia correos ni activa automatizacion.`,
      payload: {
        name: firstSentence(goal, 'Campana SUPL.IA'),
        campaignType: 'follow_up',
        steps,
        settings: { source: 'suplia_multiagent_job', preflightStatus },
      },
    }],
  };
}

async function runReplyAnalyst(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const sync = await runInternalTool(execution, 'replies.sync', { limit: 200 }, 'fast');
  const summary = await runInternalTool(execution, 'replies.summarize', { limit: 20 }, 'fast');
  const classified = await runInternalTool(execution, 'replies.classify_batch', { limit: 20 }, 'balanced');
  const count = Number((summary as any).count || 0);
  const byIntent = (summary as any).byIntent || {};

  return {
    status: 'completed',
    output: { sync, summary, classified },
    reasoningSummary: `Se revisaron ${count} replies recientes.`,
    artifacts: [{
      type: 'reply_brief',
      title: `Replies recientes (${count})`,
      content: `Intenciones: ${Object.entries(byIntent).map(([key, value]) => `${key}: ${value}`).join(', ') || 'sin datos'}`,
      data: { sync, summary, classified },
    }],
  };
}

async function runThreadResponder(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const input = execution.step.input_payload || {};
  const contactedId = safeText((input as any).contactedId || (input as any).contacted_id);
  if (!contactedId) {
    return {
      status: 'completed',
      output: { skipped: true, reason: 'missing_contacted_id' },
      reasoningSummary: 'No hay hilo concreto para redactar respuesta.',
    };
  }

  const draft = await runInternalTool(execution, 'thread.reply_draft', { contactedId }, 'balanced');
  const replyDraft = (draft as any).replyDraft || {};
  const draftId = safeText((draft as any).draftId || replyDraft.id);
  const content = `Para: ${replyDraft.to_email || 'sin destinatario'}\nAsunto: ${replyDraft.subject || 'sin asunto'}\n\n${replyDraft.text_body || replyDraft.html_body || ''}`;

  return {
    status: 'waiting_approval',
    output: { waitingFor: 'thread.reply_send', draft },
    reasoningSummary: 'Se creo un borrador de respuesta. El envio requiere aprobacion fuerte.',
    artifacts: [{
      type: 'thread_reply_draft',
      title: 'Borrador de respuesta en hilo',
      content,
      data: { draft },
    }],
    pendingActions: [{
      actionType: 'thread.reply_send',
      title: 'Enviar respuesta aprobada',
      description: 'Enviar esta respuesta contacta a una persona real y requiere aprobacion fuerte.',
      payload: { draftId, contactedId, source: 'suplia_multiagent_job' },
    }],
  };
}

async function runCrmOperator(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const suggestions = await runInternalTool(execution, 'followup.suggest', { days: 14, limit: 12 }, 'fast');
  const items = asArray((suggestions as any).items).slice(0, 10);
  const content = items.length
    ? items.map((item: any, index) => `${index + 1}. ${item.email || item.leadId || 'Lead'} - ${item.suggestedAction}\n${item.reason || ''}`).join('\n\n')
    : 'No hay seguimientos estancados para crear tareas ahora.';

  return {
    status: items.length > 0 ? 'waiting_approval' : 'completed',
    output: { suggestions },
    reasoningSummary: items.length > 0 ? `Se prepararon ${items.length} tareas de seguimiento para aprobacion.` : 'No se detectaron tareas de seguimiento inmediatas.',
    artifacts: [{
      type: 'pipeline_summary',
      title: `Seguimientos sugeridos (${items.length})`,
      content,
      data: { suggestions },
    }],
    pendingActions: items.length > 0 ? [{
      actionType: 'followup.create_tasks',
      title: `Crear ${items.length} tarea${items.length === 1 ? '' : 's'} de seguimiento`,
      description: 'Registrar tareas modifica el pipeline operativo y requiere aprobacion.',
      payload: { tasks: items, limit: items.length, source: 'suplia_multiagent_job' },
    }] : [],
  };
}

async function runMemoryAgent(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const goal = safeText(execution.job.goal);
  const strategy = findStrategy(execution.previousSteps, goal);
  const segmentNames = asArray(strategy.segments).map((segment: any) => safeText(segment.name)).filter(Boolean).slice(0, 3);
  const memory = await runInternalTool(execution, 'memory.propose', {
    memoryType: 'icp_preference',
    key: `icp:${firstSentence(goal, 'objetivo')}`.toLowerCase(),
    value: {
      goal,
      segments: segmentNames,
      decisionRoles: asArray(strategy.segments).flatMap((segment: any) => asArray(segment.decisionRoles)).slice(0, 8),
    },
    confidence: 0.65,
  }, 'fast');
  const items = asArray((memory as any).items);
  const firstMemory = items[0];

  return {
    status: firstMemory?.id ? 'waiting_approval' : 'completed',
    output: { memory },
    reasoningSummary: firstMemory?.id ? 'Se propuso una memoria reutilizable para aprobacion.' : 'No se propusieron memorias nuevas.',
    artifacts: [{
      type: 'note',
      title: 'Memoria propuesta',
      content: firstMemory ? `${firstMemory.key}\nEstado: ${firstMemory.status}` : 'Sin memoria propuesta.',
      data: { memory },
    }],
    pendingActions: firstMemory?.id ? [{
      actionType: 'memory.save',
      title: 'Guardar memoria para SUPL.IA',
      description: 'Aprobar esta memoria permite reutilizar este criterio en futuras decisiones.',
      payload: { memoryId: firstMemory.id, source: 'suplia_multiagent_job' },
    }] : [],
  };
}

function buildGmailAnalysisPlan(goal: string) {
  const topic = extractGmailMailboxTopic(goal);
  const cleanTopic = topic.length > 80 ? topic.slice(0, 80).trim() : topic;
  const query = cleanTopic ? buildGmailMailboxQuery({ topic: cleanTopic, sentOnly: true, newerThan: '12m' }) : '';
  return {
    topic: cleanTopic,
    query,
    searchScope: 'sent',
    maxResults: 50,
    includeBody: false,
    sentOnly: true,
    privacyMode: 'metadata_snippet',
  };
}

async function runGmailAnalyst(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const goal = safeText(execution.job.goal);
  const previousPlan = findPreviousOutput(execution.previousSteps, 'gmail_analysis_plan') as any;
  const plan = previousPlan?.queryPlan || buildGmailAnalysisPlan(goal);

  if (!plan.topic && !plan.query) {
    return {
      status: 'completed',
      output: { skipped: true, reason: 'missing_gmail_topic' },
      reasoningSummary: 'Falta un tema o query concreta para buscar en Gmail sin abrir demasiado el alcance.',
      artifacts: [{
        type: 'mailbox_search',
        title: 'Busqueda Gmail pendiente de criterio',
        content: 'Indica un tema, keyword o rango concreto antes de leer Gmail. No se leyo el mailbox.',
        data: { goal },
      }],
    };
  }

  if (execution.step.step_key === 'gmail_search_approval') {
    return {
      status: 'waiting_approval',
      output: { waitingFor: 'gmail.find_contacted_leads', queryPlan: plan },
      reasoningSummary: 'La lectura de Gmail queda preparada como aprobacion simple por privacidad.',
      pendingActions: [{
        actionType: 'gmail.find_contacted_leads',
        title: `Buscar en Gmail contactos sobre ${plan.topic || 'la query aprobada'}`,
        description: `SUPL.IA buscara en mensajes enviados de Gmail con query "${plan.query}". Maximo ${plan.maxResults} resultados, sin leer bodies completos, sin enviar correos y sin modificar CRM.`,
        payload: {
          topic: plan.topic,
          query: plan.query,
          maxResults: plan.maxResults,
          includeBody: false,
          sentOnly: true,
          newerThan: '12m',
          source: 'suplia_gmail_mailbox_job',
        },
      }],
    };
  }

  return {
    status: 'completed',
    output: { queryPlan: plan },
    reasoningSummary: `Prepare una busqueda Gmail limitada: ${plan.query}.`,
    artifacts: [{
      type: 'mailbox_search',
      title: 'Plan de busqueda Gmail',
      content: `Query propuesta: ${plan.query}\nMax resultados: ${plan.maxResults}\nDatos: metadata y snippets. No se leyo Gmail todavia.`,
      data: { queryPlan: plan },
    }],
  };
}

async function runReporter(execution: SupliaAgentExecution): Promise<SupliaAgentResult> {
  const completedSteps = execution.previousSteps.filter((step) => step.status === 'completed');
  const waitingSteps = execution.previousSteps.filter((step) => step.status === 'waiting_approval');
  const failedSteps = execution.previousSteps.filter((step) => step.status === 'failed');
  const lines = completedSteps.map((step: any, index) => {
    const summary = safeText(step.output_payload?.reasoningSummary || step.output_payload?.summary || step.title);
    return `${index + 1}. ${step.title || step.step_key}: ${summary || 'Completado'}`;
  });

  const content = [
    `Objetivo: ${safeText(execution.job.goal)}`,
    `Pasos completados: ${completedSteps.length}`,
    waitingSteps.length ? `Aprobaciones pendientes: ${waitingSteps.length}` : 'Aprobaciones pendientes: 0',
    failedSteps.length ? `Errores: ${failedSteps.length}` : 'Errores: 0',
    '',
    lines.join('\n') || 'Sin pasos completados para resumir.',
  ].join('\n');

  return {
    status: 'completed',
    output: {
      completedSteps: completedSteps.length,
      waitingSteps: waitingSteps.length,
      failedSteps: failedSteps.length,
      summary: content,
    },
    reasoningSummary: 'Resumen final del job generado con trazabilidad de pasos.',
    artifacts: [{
      type: 'note',
      title: 'Resumen final SUPL.IA',
      content,
      data: {
        jobId: execution.job.id,
        completedSteps: completedSteps.map((step: any) => ({ key: step.step_key, title: step.title, status: step.status })),
      },
    }],
  };
}

const AGENTS: Record<SupliaAgentName, SupliaAgentDefinition> = {
  planner: {
    name: 'planner',
    title: 'Planner',
    modelTier: 'reasoning',
    handler: runPlanner,
  },
  'icp-strategist': {
    name: 'icp-strategist',
    title: 'ICP Strategist',
    modelTier: 'reasoning',
    handler: runIcpStrategist,
  },
  prospector: {
    name: 'prospector',
    title: 'Prospector',
    modelTier: 'orchestrator',
    handler: runProspector,
  },
  'company-scorer': {
    name: 'company-scorer',
    title: 'Company Scorer',
    modelTier: 'orchestrator',
    handler: runCompanyScorer,
  },
  'lead-scorer': {
    name: 'lead-scorer',
    title: 'Lead Scorer',
    modelTier: 'orchestrator',
    handler: runLeadScorer,
  },
  enricher: {
    name: 'enricher',
    title: 'Enricher',
    modelTier: 'orchestrator',
    handler: runEnricher,
  },
  copywriter: {
    name: 'copywriter',
    title: 'Copywriter',
    modelTier: 'balanced',
    handler: runCopywriter,
  },
  compliance: {
    name: 'compliance',
    title: 'Compliance',
    modelTier: 'orchestrator',
    handler: runCompliance,
  },
  'campaign-operator': {
    name: 'campaign-operator',
    title: 'Campaign Operator',
    modelTier: 'orchestrator',
    handler: runCampaignOperator,
  },
  'reply-analyst': {
    name: 'reply-analyst',
    title: 'Reply Analyst',
    modelTier: 'balanced',
    handler: runReplyAnalyst,
  },
  'thread-responder': {
    name: 'thread-responder',
    title: 'Thread Responder',
    modelTier: 'balanced',
    handler: runThreadResponder,
  },
  'gmail-analyst': {
    name: 'gmail-analyst',
    title: 'Gmail Analyst',
    modelTier: 'orchestrator',
    handler: runGmailAnalyst,
  },
  'crm-operator': {
    name: 'crm-operator',
    title: 'CRM Operator',
    modelTier: 'orchestrator',
    handler: runCrmOperator,
  },
  'memory-agent': {
    name: 'memory-agent',
    title: 'Memory Agent',
    modelTier: 'fast',
    handler: runMemoryAgent,
  },
  reporter: {
    name: 'reporter',
    title: 'Reporter',
    modelTier: 'fast',
    handler: runReporter,
  },
};

export function getSupliaAgent(name: string) {
  return AGENTS[name as SupliaAgentName] || null;
}

export function listSupliaAgents() {
  return Object.values(AGENTS).map((agent) => ({
    name: agent.name,
    title: agent.title,
    modelTier: agent.modelTier,
    modelName: getOpenAiModelForTier(agent.modelTier),
  }));
}

export async function runSupliaAgent(name: string, execution: SupliaAgentExecution): Promise<SupliaAgentResult & { modelTier: OpenAiModelTier; modelName: string }> {
  const agent = getSupliaAgent(name);
  if (!agent) throw new Error(`Subagente no soportado: ${name}`);
  const result = await agent.handler(execution);
  return {
    ...result,
    modelTier: agent.modelTier,
    modelName: result.modelName || getOpenAiModelForTier(agent.modelTier),
  };
}
