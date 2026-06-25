type JobLike = {
  id?: string | null;
  goal?: string | null;
  job_type?: string | null;
  jobType?: string | null;
};

type StepLike = {
  step_key?: string | null;
  title?: string | null;
  description?: string | null;
};

type ActionLike = {
  action_type?: string | null;
  actionType?: string | null;
  title?: string | null;
  description?: string | null;
  payload?: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown, fallback: string) {
  if (Array.isArray(value)) {
    const items = value.map((item) => clean(item)).filter(Boolean);
    return items.length > 0 ? items.join(', ') : fallback;
  }
  return clean(value) || fallback;
}

function providerLabel(value: unknown) {
  const provider = clean(value).toLowerCase();
  if (provider === 'apollo') return 'Apollo';
  if (provider === 'pdl') return 'People Data Labs';
  if (provider === 'auto') return 'automatico segun disponibilidad';
  return provider || 'automatico segun disponibilidad';
}

export function buildSupliaJobIntroMessage(job: JobLike) {
  const jobType = clean(job.job_type || job.jobType);
  const isGmail = jobType === 'gmail_mailbox_analysis';

  if (isGmail) {
    return [
      'Entendido. Voy a trabajar esto como un flujo seguro, sin leer tu Gmail todavia.',
      '',
      'Plan inicial:',
      '1. Preparar una query acotada y revisar el alcance.',
      '2. Pedirte aprobacion antes de acceder al mailbox.',
      '3. Analizar los resultados aprobados y dejar un resumen auditable.',
      '',
      'Te ire contando cada paso en este hilo.',
    ].join('\n');
  }

  return [
    'Entendido. No voy a buscar leads ni consumir creditos todavia.',
    '',
    'Plan inicial:',
    '1. Ordenar el objetivo y proponer un plan de trabajo.',
    '2. Pedirte aprobacion del plan antes de seguir.',
    '3. Definir ICP y criterios de busqueda.',
    '4. Dejar la busqueda externa como aprobacion separada antes de usar Apollo/PDL.',
    '',
    'Te ire contando que estoy haciendo en este hilo.',
  ].join('\n');
}

export function buildSupliaStepStartedMessage(step: StepLike) {
  const key = clean(step.step_key);
  if (key === 'planner') return 'Voy a preparar el plan operativo: objetivo, pasos, supuestos y riesgos antes de ejecutar nada.';
  if (key === 'plan_approval') return 'Plan preparado. Ahora necesito que lo revises y apruebes antes de continuar.';
  if (key === 'icp_strategy') return 'Plan aprobado. Ahora voy a definir ICP, segmentos y criterios de busqueda sin consumir creditos.';
  if (key === 'prospector_approval') return 'Estoy preparando la busqueda externa como una accion aprobable. No se ejecutara hasta que la apruebes.';
  if (key === 'company_scoring') return 'Ya tengo empresas aprobadas. Ahora voy a priorizarlas contra el ICP y descartar duplicados internos.';
  if (key === 'people_search_approval') return 'Estoy preparando la busqueda de personas en las empresas priorizadas. Quedara pendiente de aprobacion antes de consumir creditos.';
  if (key === 'lead_scoring') return 'Voy a ordenar los contactos encontrados por fit, rol y senales utiles.';
  if (key === 'enrichment_approval') return 'Estoy preparando enrichment como una aprobacion separada antes de gastar creditos adicionales.';
  if (key === 'gmail_analysis_plan') return 'Voy a preparar una query segura para Gmail sin acceder todavia al mailbox.';
  if (key === 'gmail_search_approval') return 'La lectura de Gmail requiere tu aprobacion. Voy a dejarla lista con alcance y limites claros.';
  if (key === 'reporter') return 'Estoy preparando un cierre claro con resultados, decisiones y siguientes pasos.';
  return `Estoy trabajando en: ${clean(step.title) || 'siguiente paso'}.`;
}

export function buildSupliaStepCompletedMessage(step: StepLike, summary?: string | null) {
  const key = clean(step.step_key);
  const safeSummary = clean(summary);
  if (key === 'planner') return `Plan operativo listo.${safeSummary ? `\n\n${safeSummary}` : ''}`;
  if (key === 'icp_strategy') return `ICP y criterios de busqueda listos.${safeSummary ? `\n\n${safeSummary}` : ''}`;
  if (key === 'prospector_approval') return safeSummary || 'Necesito un criterio mas especifico antes de preparar una busqueda externa.';
  if (key === 'company_scoring') return `Scoring de empresas listo.${safeSummary ? `\n\n${safeSummary}` : ''}`;
  if (key === 'lead_scoring') return `Scoring de contactos listo.${safeSummary ? `\n\n${safeSummary}` : ''}`;
  if (key === 'reporter') return `Resumen final listo.${safeSummary ? `\n\n${safeSummary}` : ''}`;
  return `${clean(step.title) || 'Paso'} completado.${safeSummary ? `\n\n${safeSummary}` : ''}`;
}

export function buildSupliaApprovalRequiredMessage(action: ActionLike) {
  const actionType = clean(action.action_type || action.actionType);
  const title = clean(action.title) || 'Aprobacion requerida';
  const description = clean(action.description);

  if (actionType === 'workflow.approve_plan') {
    return [
      'Plan listo para revisar.',
      '',
      description || 'Si lo apruebas, sigo con ICP y criterios de busqueda. Todavia no voy a consumir creditos ni contactar personas.',
    ].join('\n');
  }

  if (actionType === 'prospecting.search_companies' || actionType === 'prospecting.search_people') {
    const payload = asRecord(action.payload);
    const searchPlan = asRecord(payload.searchPlan);
    const provider = providerLabel(payload.provider || searchPlan.provider);
    const maxCompanies = clean(payload.perPage || payload.limit || searchPlan.maxCompanies || 8);
    const queries = list(searchPlan.companyQueries || payload.companyQueries || payload.companyName || payload.query, 'criterio pendiente de revisar');
    const roles = list(searchPlan.peopleTitles || payload.peopleTitles || payload.personTitles || payload.titles, 'roles decisores');
    const locations = list(searchPlan.locations || payload.locations || payload.personLocations, 'sin ubicacion especifica');

    if (actionType === 'prospecting.search_companies') {
      return [
        'Necesito tu aprobacion antes de buscar empresas con un proveedor externo.',
        '',
        `Voy a buscar hasta ${maxCompanies} empresas para: ${queries}.`,
        `Proveedor sugerido: ${provider}.`,
        `Ubicacion: ${locations}.`,
        `Roles que se usaran despues para buscar contactos: ${roles}.`,
        '',
        'No enviare correos, no buscare contactos personales todavia y no modificare el CRM.',
      ].join('\n');
    }

    return [
      'Necesito tu aprobacion antes de buscar contactos con un proveedor externo.',
      '',
      description || 'Esta accion puede consumir creditos del proveedor. No se ejecutara sin tu permiso.',
      '',
      'No enviare correos ni modificare el CRM.',
    ].join('\n');
  }

  if (actionType.startsWith('gmail.')) {
    return [
      'Necesito tu aprobacion antes de leer Gmail.',
      '',
      description || 'La lectura se limita al alcance indicado y no envia correos ni modifica CRM.',
    ].join('\n');
  }

  return [`Necesito tu aprobacion para continuar: ${title}.`, description].filter(Boolean).join('\n\n');
}
