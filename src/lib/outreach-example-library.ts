// Style examples adapted from the user's own GrupoExpro playbook
// (plantillas-correo-grupoexpro_2.md, all six lines, role variants and annexes).
// They teach STRUCTURE and TONE only:
// subjects, openings tied to a trigger, one central idea, concrete offer,
// single next step. Facts, figures, clients and coverage claims inside them
// are NEVER evidence and must never be imported into a draft.

export type OutreachExampleGoal = 'initial' | 'proof' | 'angle' | 'close';
export type OutreachExampleRole = 'operations' | 'people' | 'finance' | 'executive' | 'any';

export type OutreachExample = {
  id: string;
  goals: OutreachExampleGoal[];
  roles: OutreachExampleRole[];
  subject: string;
  body: string;
  imitate: string;
};

const EXAMPLES: OutreachExample[] = [
  {
    id: 'initial-seasonal-staffing',
    goals: ['initial'],
    roles: ['operations'],
    subject: '[Empresa] · dotación para [temporada]',
    body: [
      'Hola [Nombre],',
      '',
      '[Disparador con fecha: vacantes publicadas, contrato adjudicado, temporada que parte. Una frase.]',
      '',
      'Si eso significa subir dotación por [período acotado], contratar directo resuelve el número pero deja el costo instalado: selección, administración de cada contrato y después la desvinculación, todo con el mismo equipo que ya está al límite.',
      '',
      'En [Mi empresa] ponemos la dotación que necesitas por el tiempo que la necesitas, y el costo se va con el peak.',
      '',
      '· Personal disponible en terreno, no solo en la capital',
      '· Selección, contratación y administración laboral por nuestra cuenta',
      '· Dotación variable: sube en [temporada] y baja sin proceso de salida',
      '',
      '¿Tiene sentido que te muestre cómo se estructura esto para una operación del tamaño de la de ustedes? Son 15 minutos.',
    ].join('\n'),
    imitate: 'Abre con un disparador fechado, nombra el costo oculto de hacerlo interno y propone una capacidad concreta con bullets verificables.',
  },
  {
    id: 'initial-process-outsourcing',
    goals: ['initial'],
    roles: ['operations'],
    subject: '[Empresa] · [el proceso] como servicio',
    body: [
      'Hola [Nombre],',
      '',
      '[Disparador: apertura de CD, crecimiento de volumen, vacantes operativas. Una frase.]',
      '',
      'En operaciones como la de [Empresa], [el proceso] termina ocupando una parte desproporcionada de la gestión, siendo que no es donde ustedes compiten.',
      '',
      'En [Mi empresa] tomamos ese proceso completo: equipo, supervisión, método e indicadores. Ustedes reciben el resultado, no la administración.',
      '',
      '· El proceso se entrega con indicadores acordados, no con una nómina de gente',
      '· Supervisión nuestra en terreno, no un jefe más para tu estructura',
      '· Escalamos el equipo cuando el volumen sube, sin proceso de contratación',
      '',
      '¿Te sirve que revisemos cómo se estructuraría en [el proceso] de ustedes? 15 minutos y sales sabiendo si aplica o no.',
    ].join('\n'),
    imitate: 'Convierte el proceso de soporte en una línea de resultado con responsable único, sin hablar de tu empresa primero.',
  },
  {
    id: 'initial-stalled-search',
    goals: ['initial'],
    roles: ['people'],
    subject: 'La vacante de [cargo] en [Empresa]',
    body: [
      'Hola [Nombre],',
      '',
      'Vi que la búsqueda de [cargo] en [Empresa] lleva [N] semanas publicada.',
      '',
      'Cuando un proceso se alarga así, rara vez es el sueldo. Normalmente es que el equipo que hace la búsqueda además tiene que administrar todo lo demás, y una búsqueda a medio tiempo toma el doble.',
      '',
      'En [Mi empresa] hacemos reclutamiento, selección y evaluación del candidato, y entregamos una terna con el respaldo completo de cada uno.',
      '',
      '¿Vale 15 minutos revisar el perfil y te digo con franqueza si es una búsqueda que podemos cerrar rápido o no?',
    ].join('\n'),
    imitate: 'Nombra la señal observable, reencuadra la causa probable sin culpar y ofrece un diagnóstico honesto en vez de una promesa.',
  },
  {
    id: 'initial-executive',
    goals: ['initial'],
    roles: ['executive'],
    subject: '[Empresa] · [el resultado, no el servicio]',
    body: [
      'Hola [Nombre],',
      '',
      '[Disparador en una frase.]',
      '',
      'Para una operación del tamaño de [Empresa] eso normalmente significa [consecuencia de negocio: costo instalado, riesgo de no cubrir, gestión que consume a la primera línea].',
      '',
      'En [Mi empresa] llevamos años resolviendo exactamente eso. [Una frase de resultado, no de proceso.]',
      '',
      '¿Vale 15 minutos ver si aplica acá? Si no aplica, te lo digo yo mismo en esos 15 minutos.',
    ].join('\n'),
    imitate: 'Menos de 90 palabras, sin bullets ni proceso: disparador, consecuencia de negocio y una salida fácil para decir que no.',
  },
  {
    id: 'initial-hidden-cost',
    goals: ['initial'],
    roles: ['finance'],
    subject: '[Empresa] · el costo instalado de [el proceso]',
    body: [
      'Hola [Nombre],',
      '',
      '[Disparador en una frase.]',
      '',
      'El costo de operar [el proceso] internamente casi nunca es el que aparece en el presupuesto. Al sueldo hay que sumarle reclutamiento, rotación, administración y ausentismo, repartidos en líneas que nadie suma juntas.',
      '',
      'Externalizarlo lo convierte en una tarifa sola, variable según volumen.',
      '',
      '· Una línea de costo comparable mes a mes',
      '· Sin costo instalado cuando el volumen baja',
      '',
      '¿15 minutos para armar el comparativo con lo que gastan hoy?',
    ].join('\n'),
    imitate: 'Habla de estructura de costo, no de servicio: suma los costos ocultos y reduce la decisión a una línea comparable.',
  },
  {
    id: 'followup-proof',
    goals: ['proof'],
    roles: ['any'],
    subject: 'Re: [asunto del toque 1]',
    body: [
      'Hola [Nombre],',
      '',
      'Te dejo el dato que normalmente falta para decidir si esto merece 15 minutos.',
      '',
      '[Una prueba respaldada: años operando, clientes, cobertura. Una sola, conectada con el caso de esta cuenta.]',
      '',
      'El punto que suele generar dudas: [responde la objeción frecuente en dos líneas, sin tecnicismos].',
      '',
      '¿[Día] a las [hora] o [día] a las [hora]?',
    ].join('\n'),
    imitate: 'Mismo hilo, más corto que el inicial: una prueba, una objeción resuelta y dos horarios concretos.',
  },
  {
    id: 'followup-second-angle',
    goals: ['angle'],
    roles: ['any'],
    subject: '[Empresa] · [segundo ángulo en tres o cuatro palabras]',
    body: [
      'Hola [Nombre],',
      '',
      'Te escribo directo porque el tema pega en tu área.',
      '',
      '[El mismo disparador, reformulado desde la perspectiva de este cargo.]',
      '',
      '[El costo o riesgo que no se ve, en dos o tres líneas.]',
      '',
      '· [Cambio concreto 1]',
      '· [Cambio concreto 2]',
      '',
      '¿15 minutos esta semana o la próxima?',
    ].join('\n'),
    imitate: 'Hilo nuevo con otro ángulo para el mismo tema: no repitas el correo anterior, reformula el disparador y cambia el encuadre.',
  },
  {
    id: 'close-cycle',
    goals: ['close'],
    roles: ['any'],
    subject: 'Cerrando el ciclo — [Empresa]',
    body: [
      'Hola [Nombre],',
      '',
      'Te escribí un par de veces sobre [tema] y no tuve respuesta, así que asumo que no es prioridad ahora. Perfecto, dejo de ocupar espacio en tu bandeja.',
      '',
      'Esta es la última nota que te mando sobre esto. Si en algún momento [Empresa] necesita [el resultado, en cuatro palabras], tienes mi correo acá arriba.',
      '',
      'Gracias por el tiempo de leer hasta acá.',
    ].join('\n'),
    imitate: 'Menos de 80 palabras, sin culpa ni presión: cierra el ciclo de verdad y deja la puerta abierta con el resultado en pocas palabras.',
  },
];

export function selectOutreachExamples(input: {
  goal: OutreachExampleGoal;
  role?: string | null;
  count?: number;
  avoidIds?: string[];
  offering?: string | null;
}): OutreachExample[] {
  const avoid = new Set(input.avoidIds || []);
  const normalizedRole = String(input.role || '').toLocaleLowerCase('es');
  const role: OutreachExampleRole = /operac|planta|log[ií]stica|supply|bodega/.test(normalizedRole)
    ? 'operations'
    : /persona|rr\.?hh|recursos humanos|talento|people/.test(normalizedRole)
      ? 'people'
      : /finanza|administra|controller|tesorer/.test(normalizedRole)
        ? 'finance'
        : /gerente general|general manager|ceo|director general|socio|founder|dueño/.test(normalizedRole)
          ? 'executive'
          : 'any';
  // Select the seller's offering first; the prospect's industry never authorizes
  // selling a different service. Unrelated sellers get neutral scaffolding.
  if (input.offering !== undefined) {
    const offering = String(input.offering || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const lines = [
      { id: 'est', match: /servicios transitorios|\best\b|dotacion|personal temporal/, theme: 'dotación por período acotado', mechanism: 'alcance de selección y administración laboral autorizado; nunca exención total de responsabilidad legal' },
      { id: 'bpo', match: /outsourcing|\bbpo\b|externaliza|picking|packing|back office/, theme: 'un proceso con responsable e indicadores', mechanism: 'distinguir servicio completo de suministro de personal, solo si lo declara el vendedor' },
      { id: 'hunting', match: /seleccion|hunting|reclutamiento|recruit/, theme: 'una búsqueda y su evaluación', mechanism: 'distinguir volumen de búsquedas de vacante estancada solo con evidencia; no prometer plazos ni garantía' },
      { id: 'facility', match: /facility|aseo|mantencion|servicios generales/, theme: 'estándar del servicio por sede', mechanism: 'control y coordinación del servicio autorizado, sin inventar cantidad de sedes ni proveedores' },
      { id: 'security', match: /seguridad privada|vigilancia|guardias|security/, theme: 'cobertura y trazabilidad de turnos', mechanism: 'alcance autorizado de vigilancia; no trasladar un ranking a retención ni garantizar cobertura' },
      { id: 'technology', match: /tecnolog|software|plataforma|digital|automatiza/, theme: 'trazabilidad de un proceso concreto', mechanism: 'solo funcionalidades declaradas; nunca asumir Workges, implementación sin TI ni capacidades del ejemplo' },
    ].filter((line) => line.match.test(offering));
    const line = lines[0] || { id: 'neutral', theme: 'una aplicación de la oferta autorizada', mechanism: 'usar exclusivamente capacidades del vendedor, sin convertir su oferta en servicios de RRHH' };
    const roleAngle = { executive: 'resultado de negocio, menos de 90 palabras y sin bullets', operations: 'capacidad, continuidad y tiempos; no inventar fallas', people: 'liberar carga del equipo y trazabilidad, no reemplazarlo', finance: 'estructura y previsibilidad del costo, sin prometer ahorro', any: 'una aplicación pertinente sin inferir autoridad de compra' }[role];
    const stage = { initial: 'hecho verificable → aplicación → capacidad autorizada', proof: 'una prueba autorizada distinta o un detalle de aplicación cuando no hay prueba', angle: 'otro aspecto del mismo servicio para la misma persona; sin inventar otro interlocutor ni conversaciones', close: 'cierre breve y sin presión, menos de 80 palabras; no afirmar silencio ni envíos previos' }[input.goal];
    const bodies = {
      initial: `Hola [Nombre],\n\n[Disparador verificado vinculado con ${line.theme}; si solo hay actividad conocida, plantear una aplicación sin atribuir necesidad].\n\nEn [empresa vendedora] [acción concreta autorizada]. [Consecuencia práctica conectada con la cuenta, no promesa].\n\n[Único CTA aprobado].`,
      proof: `Hola [Nombre],\n\n[Una prueba autorizada aplicada a ${line.theme}; si no hay prueba, explicar un alcance concreto del servicio].\n\n[Una distinción útil que no repita la apertura ni presente de nuevo al vendedor].\n\n[Único CTA aprobado].`,
      angle: `Hola [Nombre],\n\n[Una segunda aplicación de ${line.theme}, pertinente al mismo cargo y respaldada por el brief].\n\n[Qué cambia en esta aplicación, sin sumar otra línea de servicio ni atribuir problemas].\n\n[Único CTA aprobado].`,
      close: `Hola [Nombre],\n\n[Cierre breve del tema de ${line.theme}, dejando una salida sin presión]. [Resultado autorizado en pocas palabras, sin nuevo pitch ni afirmar falta de respuesta].\n\n[Único CTA aprobado; sin agregar otro pedido].`,
    };
    return [{ id: `v2-${line.id}-${role}-${input.goal}`, goals: [input.goal], roles: [role], subject: input.goal === 'close' ? 'Cerrando el ciclo — [Empresa]' : '[Empresa] · [tema concreto]', body: bodies[input.goal], imitate: `${stage}. ${line.mechanism}. Adaptación por cargo: ${roleAngle}. No importar cifras, marcas, clientes, cobertura, garantías ni condiciones legales del documento.` }].filter((example) => !avoid.has(example.id));
  }
  const pool = EXAMPLES.filter((example) => example.goals.includes(input.goal) && !avoid.has(example.id));
  const ranked = [...pool].sort((left, right) => {
    const leftRole = left.roles.includes(role) || left.roles.includes('any') ? 0 : 1;
    const rightRole = right.roles.includes(role) || right.roles.includes('any') ? 0 : 1;
    if (leftRole !== rightRole) return leftRole - rightRole;
    return left.id.localeCompare(right.id);
  });
  return ranked.slice(0, Math.max(1, Math.min(3, input.count ?? 2)));
}

export function outreachExampleById(id: string) {
  return EXAMPLES.find((example) => example.id === id) || null;
}
