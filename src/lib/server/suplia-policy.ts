export type SupliaRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SupliaApprovalKind = 'none' | 'simple' | 'strong';

export type SupliaPolicy = {
  riskLevel: SupliaRiskLevel;
  requiresApproval: boolean;
  approvalKind: SupliaApprovalKind;
  approvalReason: string;
};

const DEFAULT_POLICY: SupliaPolicy = {
  riskLevel: 'high',
  requiresApproval: true,
  approvalKind: 'strong',
  approvalReason: 'Esta accion puede modificar datos, consumir creditos o contactar personas. Requiere aprobacion antes de ejecutarse.',
};

const POLICIES: Record<string, SupliaPolicy> = {
  'workflow.approve_plan': {
    riskLevel: 'low',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Aprueba el plan operativo antes de continuar con subagentes. No consume creditos ni ejecuta acciones externas.',
  },
  'app.context.get': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna de contexto de la app.',
  },
  'profile.get_company_profile': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura del perfil configurado por el usuario.',
  },
  'gmail.profile.get': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura del estado de conexion Gmail y perfil basico de mailbox.',
  },
  'gmail.search_messages': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Lee metadata y snippets del mailbox privado de Gmail.',
  },
  'gmail.get_message': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Lee un mensaje privado de Gmail.',
  },
  'gmail.get_thread': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Lee un hilo privado de Gmail.',
  },
  'gmail.search_threads': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Agrupa y lee metadata de hilos privados de Gmail.',
  },
  'gmail.find_contacted_leads': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Busca en Gmail para identificar personas contactadas desde el mailbox privado.',
  },
  'gmail.match_crm': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Cruce interno contra CRM/contactados despues de obtener resultados Gmail aprobados.',
  },
  'gmail.summarize_results': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Resumen interno de resultados Gmail ya obtenidos.',
  },
  'crm.search': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna de leads del CRM.',
  },
  'crm.get_lead_detail': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna del detalle de un lead.',
  },
  'contacted.search': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna de contactos ya gestionados.',
  },
  'contacted.get_timeline': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna de historial de contacto y eventos.',
  },
  'campaigns.list': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna de campanas guardadas.',
  },
  'campaigns.get': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna del detalle de una campana.',
  },
  'antonia.missions.list': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna de misiones ANTONIA.',
  },
  'antonia.exceptions.list': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna de excepciones abiertas de ANTONIA.',
  },
  'metrics.overview': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura agregada de metricas internas.',
  },
  'privacy.contactability.check': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Verificacion interna de bloqueos y guardrails de contacto.',
  },
  'privacy.batch_contactability.check': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Verificacion interna por lote de bloqueos, bajas y rebotes.',
  },
  'prospecting.suggest_segments': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Planificacion interna de ICP sin consumo de creditos externos.',
  },
  'prospecting.build_search_plan': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Construccion interna de criterios de busqueda sin llamar proveedores externos.',
  },
  'prospecting.search_companies': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Las busquedas externas pueden consumir creditos de proveedor.',
  },
  'prospecting.search_people': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Las busquedas externas pueden consumir creditos de proveedor.',
  },
  'prospecting.dedupe_against_crm': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Deduplicacion interna contra CRM y contactos existentes.',
  },
  'prospecting.create_shortlist': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Organizacion interna de resultados en shortlist.',
  },
  'prospecting.score_companies': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Scoring interno contra ICP sin proveedores externos.',
  },
  'prospecting.score_people': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Scoring interno de leads contra ICP sin proveedores externos.',
  },
  'lead.enrich': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'El enriquecimiento puede consumir creditos externos.',
  },
  'lead.enrich_batch': {
    riskLevel: 'high',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'El enriquecimiento por lote puede consumir creditos externos.',
  },
  'email.personalize_for_lead': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Redaccion interna de borrador. No envia correos.',
  },
  'email.bulk_variant_preview': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Preview interno de variantes. No envia correos.',
  },
  'campaign.preview_for_lead': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Preview interno de campana para revision.',
  },
  'compliance.preflight_email': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Revision interna de compliance antes de enviar.',
  },
  'compliance.preflight_campaign': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Revision interna de compliance antes de guardar o lanzar campana.',
  },
  'campaign.create_draft': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Guardar una campana crea datos operativos persistentes.',
  },
  'campaign.get_status': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna del estado de una campana.',
  },
  'campaign.update': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Actualizar una campana modifica datos operativos persistentes.',
  },
  'campaign.launch': {
    riskLevel: 'high',
    requiresApproval: true,
    approvalKind: 'strong',
    approvalReason: 'Lanzar una campana puede contactar multiples destinatarios.',
  },
  'campaign.pause': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Pausar una campana modifica su automatizacion.',
  },
  'campaign.resume': {
    riskLevel: 'high',
    requiresApproval: true,
    approvalKind: 'strong',
    approvalReason: 'Reanudar una campana puede permitir nuevos envios automaticos.',
  },
  'email.send': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Enviar un email contacta a una persona real y queda registrado.',
  },
  'email.bulk_send': {
    riskLevel: 'critical',
    requiresApproval: true,
    approvalKind: 'strong',
    approvalReason: 'El bulk send contacta multiples personas y requiere revision explicita de volumen, destinatarios y contenido.',
  },
  'replies.sync': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Sincronizacion interna de replies ya recibidas.',
  },
  'replies.summarize': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Resumen interno de replies existentes.',
  },
  'replies.classify_batch': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Clasificacion interna de replies existentes.',
  },
  'thread.reply_draft': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Redaccion de borrador de respuesta en hilo. No envia correos.',
  },
  'thread.reply_send': {
    riskLevel: 'high',
    requiresApproval: true,
    approvalKind: 'strong',
    approvalReason: 'Enviar una respuesta en hilo contacta a una persona real y requiere aprobacion explicita.',
  },
  'playbook.list': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura de playbooks internos.',
  },
  'playbook.get': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura de un playbook interno.',
  },
  'playbook.create': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Crear un playbook modifica automatizaciones reutilizables.',
  },
  'playbook.update': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Actualizar un playbook modifica automatizaciones reutilizables.',
  },
  'playbook.archive': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Archivar un playbook modifica su disponibilidad operativa.',
  },
  'playbook.apply': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Aplicar un playbook crea un nuevo job persistente.',
  },
  'campaign.generate_sequence': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Redaccion interna de una secuencia editable. No guarda ni lanza campanas.',
  },
  'crm.update_stage': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Actualizar CRM modifica datos operativos.',
  },
  'crm.set_next_action': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Registrar proximas acciones modifica el seguimiento comercial.',
  },
  'crm.add_note': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Agregar notas modifica el historial comercial.',
  },
  'crm.assign_owner': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Asignar owner modifica responsabilidad comercial.',
  },
  'pipeline.detect_stalled': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura interna para detectar oportunidades estancadas.',
  },
  'followup.suggest': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Sugerencia interna de proximos pasos.',
  },
  'followup.create_tasks': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Crear tareas de seguimiento modifica el pipeline operativo.',
  },
  'memory.search': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Lectura de memorias aprobadas o propuestas.',
  },
  'memory.propose': {
    riskLevel: 'low',
    requiresApproval: false,
    approvalKind: 'none',
    approvalReason: 'Propone memoria editable; no queda aprobada automaticamente.',
  },
  'memory.save': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Guardar memoria aprobada afecta decisiones futuras de SUPL.IA.',
  },
  'memory.forget': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Olvidar memoria modifica preferencias persistentes.',
  },
  'antonia.create_mission': {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Crear una mision prepara automatizacion operativa.',
  },
  'antonia.trigger_mission': {
    riskLevel: 'high',
    requiresApproval: true,
    approvalKind: 'strong',
    approvalReason: 'Disparar una mision puede iniciar trabajo automatico con proveedores y contactos.',
  },
};

export function getSupliaPolicy(name: string): SupliaPolicy {
  return POLICIES[name] || DEFAULT_POLICY;
}

export function canRunWithoutApproval(name: string) {
  return !getSupliaPolicy(name).requiresApproval;
}
