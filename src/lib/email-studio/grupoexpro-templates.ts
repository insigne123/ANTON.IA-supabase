import type { StyleProfile } from '@/lib/types';

// References, not marketing-approved copy. Never include in global presets.
export const GRUPOEXPRO_REFERENCE_TEMPLATES = [
  ['est', 'Servicios Transitorios (EST)', 'dotacion temporal', 'Para una necesidad temporal de personal, partiria por los turnos y la fecha de termino, no por una dotacion permanente.', '¿Revisamos los turnos y el periodo que quieren cubrir?', 'Usar ante temporada, proyecto o reemplazo documentado. Hablar con operaciones de turnos; con personas, de administracion laboral. No convertir vacantes en un peak confirmado.'],
  ['bpo', 'Outsourcing / BPO', 'operacion de bodega', 'En un proceso de bodega, conviene separar cuantas personas participan de que resultado debe entregar el servicio. El punto de partida es el proceso y como medirlo.', '¿Revisamos que parte del proceso tendria sentido externalizar?', 'Elegir un solo proceso acreditado: picking, packing, inventario o back office. No asumir que esta externalizado ni que funciona mal. Adaptar asunto y ejemplo al proceso real.'],
  ['seleccion', 'Seleccion y Hunting', 'busqueda de talento', 'Para una busqueda de talento, partiria por el perfil que necesitan incorporar y los criterios para evaluar candidatos, antes de ofrecer un plazo de cierre.', '¿La busqueda sigue abierta?', 'Usar una vacante identificada; mencionar cargo, antiguedad o cantidad solo con respaldo. Distinguir una vacante dificil de contratacion en volumen. No culpar al equipo interno.'],
  ['facility', 'Facility Management - ExproFacility', 'aseo y mantencion', 'Para revisar aseo y mantencion, empezaria por el estandar esperado en cada instalacion y como comprobar su cumplimiento, antes de comparar tarifas.', '¿Revisamos el estandar que necesitan en sus instalaciones?', 'Usar aperturas o instalaciones verificadas. Con operaciones hablar de continuidad; con administracion, de control del servicio. No inventar sedes ni proveedores actuales.'],
  ['security', 'Seguridad Privada - ExproSecurity', 'cobertura de turnos', 'Para revisar vigilancia, empezaria por los turnos, los reemplazos y el registro de novedades. Eso permite definir el alcance del servicio antes de hablar de una tarifa.', '¿Revisamos como tienen organizada la cobertura de turnos?', 'Usar una instalacion verificada. Diferenciar cobertura de turnos y trazabilidad. No afirmar incidentes, rotacion ni brechas de seguridad del prospecto sin evidencia.'],
  ['technology', 'Soluciones Tecnologicas - GrupoExpro Technology', 'documentacion de personas', 'Para digitalizar la gestion de personas, partiria por un proceso concreto: que documento se necesita, quien lo actualiza y como se consulta. Despues viene la herramienta.', '¿Revisamos un proceso que quieran digitalizar?', 'Elegir documentacion, turnos o capacitacion segun evidencia. No afirmar uso de planillas ni vender Workges o integraciones sin respaldo del perfil comercial.'],
].map(([id, name, topic, value, cta, situation]) => ({
  id: `grupoexpro:${id}`, name, collection: 'grupoexpro' as const,
  status: 'editable-reference' as const,
  profile: {
    name, scope: 'leads', tone: 'consultative', length: 'short', language: 'es',
    structure: ['context', 'value', 'cta'],
    instructions: `Referencia editable, no aprobada por marketing. ${situation} Reemplazar la apertura del ejemplo por una senal verificada y conectar una capacidad real del remitente; el ejemplo no autoriza capacidades. Sin senal pertinente, no inventarla. Una sola pregunta final.`,
    do: ['abrir con el hecho seleccionado, no con una presentacion', 'usar solo capacidades verificadas del perfil comercial', 'para gerencia general priorizar resultado; para finanzas, estructura de costo', 'en el primer seguimiento aportar respaldo aprobado sin repetir el inicial', 'en el siguiente mensaje aportar otro aspecto concreto; en el cierre no volver a vender'],
    dont: ['afirmar dolores no verificados', 'prometer resultados o exencion de responsabilidades'],
    personalization: { useLeadName: true, useCompanyName: true, useReportSignals: true },
    constraints: { noFabrication: true, noSensitiveClaims: true },
    cta: { label: cta },
    subjectTemplate: `{{company.name}} - ${topic}`,
    bodyTemplate: `Hola {{lead.firstName}},\n\n${value}\n\n{{companyProfile.valueProposition}}\n\n${cta}\n\n{{sender.name}}\n{{sender.company}}`,
  } satisfies StyleProfile,
}));
