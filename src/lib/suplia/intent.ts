export type SupliaConversationIntent =
  | 'smalltalk'
  | 'capabilities'
  | 'company_context'
  | 'out_of_scope'
  | 'direct_answer'
  | 'artifact_create'
  | 'artifact_update'
  | 'job_workflow'
  | 'pending_action'
  | 'clarification_needed';

export type SupliaIntentResult = {
  intent: SupliaConversationIntent;
  confidence: number;
  reason: string;
};

function normalizeIntentText(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text: string) {
  return text ? text.split(/\s+/g).filter(Boolean).length : 0;
}

function isOutOfScopeGeneralQuestion(text: string, words: number) {
  const hasAppDomainSignal = /\b(anton|antonia|supl|suplia|app|empresa|negocio|compania|ventas?|comercial|cliente|clientes|lead|leads|prospecto|prospectos|prospecting|crm|pipeline|gmail|correo|correos|email|mail|mailbox|campana|campanas|campaign|secuencia|followup|follow up|outreach|apollo|pdl|linkedin|icp|buyer persona|propuesta|cotizacion|reunion|meeting|automatizacion|workflow|artifact|artefacto|borrador|copy|mensaje|reporte|analisis comercial)\b/.test(text);
  if (hasAppDomainSignal) return false;

  const numberCount = (text.match(/\b\d+(?:[.,]\d+)?\b/g) || []).length;
  const mathTopic = /\b(pi|matematicas|ecuacion|ecuaciones|algebra|geometria|calculo)\b/.test(text);
  const arithmeticRequest = /\b(cuanto es|calcula|calcular|resultado de|resuelve|resolver|suma|sumar|resta|restar|multiplica|multiplicar|divide|dividir)\b/.test(text);
  if (arithmeticRequest && (numberCount >= 2 || mathTopic)) return true;

  const generalKnowledgeTopic = /\b(gravedad|espacio|universo|planeta|planetas|galaxia|galaxias|estrella|estrellas|fisica|quimica|biologia|historia|geografia|matematicas|ecuacion|ecuaciones|algebra|geometria|calculo|pi|receta|deporte|futbol|pelicula|musica|religion|filosofia|clima|capital de|presidente|pais|paises)\b/.test(text);
  if (!generalKnowledgeTopic) return false;

  const generalQuestionShape = /\b(que es|que significa|quien es|cuando fue|donde esta|por que|porque|cuanto es|explica|define|cuentame sobre)\b/.test(text);
  return generalQuestionShape || words <= 12;
}

export function classifySupliaIntent(message: string): SupliaIntentResult {
  const text = normalizeIntentText(message);
  const words = wordCount(text);

  if (!text) {
    return { intent: 'clarification_needed', confidence: 1, reason: 'empty_message' };
  }

  const greetingOnly = /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|hello|que tal|como estas|gracias|thanks|ok|dale|perfecto|genial)$/.test(text);
  if (greetingOnly || (words <= 4 && /^(hola|buenas|hey|hi|hello)\b/.test(text))) {
    return { intent: 'smalltalk', confidence: 0.98, reason: 'short_greeting_or_ack' };
  }

  if (/\b(que puedes hacer|que haces|como me ayudas|como puedes ayudar|capacidades|funciones|ayuda|help|como funciona|para que sirves)\b/.test(text)) {
    return { intent: 'capabilities', confidence: 0.95, reason: 'capability_question' };
  }

  if (/\b(conoces|conoces mi|sabes|que sabes|tienes contexto|entiendes|recuerdas)\b.*\b(mi empresa|mi compania|mi compañia|mi negocio|empresa|compania|compañia|negocio)\b/.test(text) || /\b(mi empresa|mi compania|mi compañia|mi negocio)\b.*\b(conoces|sabes|contexto|entiendes|recuerdas)\b/.test(text)) {
    return { intent: 'company_context', confidence: 0.92, reason: 'company_context_question' };
  }

  if (isOutOfScopeGeneralQuestion(text, words)) {
    return { intent: 'out_of_scope', confidence: 0.9, reason: 'general_knowledge_outside_product_scope' };
  }

  const asksSensitiveAction = /\b(envia|enviar|manda|mandar|contacta|contactar|lanza|lanzar|reanuda|reanudar|pausa|pausar|actualiza|actualizar|asigna|asignar|guarda memoria|olvida memoria|gmail|correo|correos|mailbox|apollo|pdl|enrich|enriquec|crm|leads?|empresas?|contactos?|prospectos?|bulk|masivo|campana|campaña)\b/.test(text);
  const asksExecution = /\b(busca|buscar|encuentra|encontrar|revisa|revisar|analiza|analizar|investiga|investigar|prospecta|prospectar|crea|crear|prepara|preparar|automatiza|automatizar|orquesta|orquestar)\b/.test(text);

  if (asksSensitiveAction && asksExecution) {
    return { intent: 'job_workflow', confidence: 0.9, reason: 'operational_workflow' };
  }

  if (asksSensitiveAction) {
    return { intent: 'pending_action', confidence: 0.82, reason: 'sensitive_action' };
  }

  if (/\b(hazlo|hacelo|cambialo|cambia|actualizalo|actualiza esto|modifica|reformula|resumelo|mejoralo|mas corto|mas largo|tono|agrega|quita|reduce|expande)\b/.test(text)) {
    return { intent: 'artifact_update', confidence: 0.76, reason: 'artifact_edit_language' };
  }

  if (/\b(redacta|escribe|crea|crear|genera|generar|borrador|email|mail|correo|plan|documento|reporte|tabla|resumen|propuesta|campana|campaña|copy|mensaje)\b/.test(text)) {
    return { intent: 'artifact_create', confidence: 0.78, reason: 'artifact_creation_language' };
  }

  if (words <= 10 && /\?$/.test(String(message || '').trim())) {
    return { intent: 'direct_answer', confidence: 0.7, reason: 'short_question' };
  }

  return { intent: 'direct_answer', confidence: 0.55, reason: 'default_chat' };
}

export function getSupliaDirectReply(intent: SupliaIntentResult) {
  if (intent.intent === 'smalltalk') {
    return 'Hola. Soy SUPL.IA. Puedo ayudarte a pensar, redactar, crear artefactos y operar la app con aprobaciones cuando haga falta. Dime que quieres lograr.';
  }

  if (intent.intent === 'capabilities') {
    return [
      'Puedo ayudarte de tres formas:',
      '',
      '1. Conversar y resolver dudas simples sobre tu operacion en ANTON.IA sin activar procesos innecesarios.',
      '2. Crear artefactos editables: emails, planes, reportes, campanas, listas y analisis.',
      '3. Ejecutar workflows con agentes: buscar leads, revisar Gmail, consultar CRM, preparar campanas y dejar acciones sensibles para aprobacion.',
      '',
      'Si quieres algo simple, respondere directo. Si pides una tarea larga, mostrare progreso de agentes. Si algo toca datos privados, creditos o envios, te pedire permiso antes.',
    ].join('\n');
  }

  if (intent.intent === 'out_of_scope') {
    return 'SUPL.IA no esta pensado para responder preguntas generales de fisica, cultura general o temas fuera de ANTON.IA. Estoy enfocado en ayudarte con leads, Gmail, CRM, campanas, emails, artefactos y tareas operativas. Si conectas la pregunta con una decision comercial o una tarea de la app, te ayudo.';
  }

  return null;
}
