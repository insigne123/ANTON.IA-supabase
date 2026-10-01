// A made-up set to calibrate the pre-send email review (src/lib/cowork/email-review.ts): people who wrote, and for each several replies that
// are fine and several that go wrong in one known way. The people and the seller are the anonymized ones of the AXIS bank test data; nothing
// here is a real conversation. Each reply carries the labels the questions must answer: 1 when the reply has that defect.
export type ReviewLabel = 'contradicts_thread' | 'invents_commitment' | 'ignores_question';
export type ReviewItem = { id: string; who: string; theirs: string; reply: string; labels: Record<ReviewLabel, 0 | 1> };

export const SELLER = { name: 'Nicolás Yarur', company: 'Yago', offer: 'Revisión de antecedentes laborales en el Poder Judicial en minutos, para equipos de RR. HH. en Chile. No hay precios públicos: se cotiza según el volumen.',
  services: ['Consulta de antecedentes laborales', 'Reporte por postulante'], proofPoints: [] as string[] };

const PEOPLE = {
  marcela: { name: 'Marcela Rojas (Servicios Norte)', theirs: 'Hola Nicolás, me interesó tu correo. ¿Cuánto cuesta por persona y cuánto demoran en entregar los antecedentes?' },
  hector: { name: 'Héctor Vidal (Casino Central)', theirs: 'Buenas tardes, nos interesa. ¿Podemos conversar la próxima semana? Tengo libre el martes o el miércoles en la mañana.' },
  ana: { name: 'Ana Ruiz (Alimentos del Valle)', theirs: 'Gracias por escribir, me interesa conocer más.' },
  gerardo: { name: 'Gerardo Paz (Servicios Norte)', theirs: 'Por favor no me escriban más a este correo.' },
  sofia: { name: 'Sofía Lira (Minera Norte)', theirs: 'Gracias, pero ya trabajamos con otro proveedor y estamos conformes. No por ahora.' },
  paula: { name: 'Paula Ríos (Transportes del Sur)', theirs: '¿Se integran con Buk? ¿Y tienen certificación ISO 27001? Lo pide nuestra área de TI.' },
} as const;
type Who = keyof typeof PEOPLE;

const none = { contradicts_thread: 0, invents_commitment: 0, ignores_question: 0 } as const;
const item = (id: string, who: Who, reply: string, label?: ReviewLabel): ReviewItem => ({
  id, who: PEOPLE[who].name, theirs: PEOPLE[who].theirs, reply, labels: { ...none, ...(label ? { [label]: 1 } : {}) } as ReviewItem['labels'] });

export const REVIEW_SET: ReviewItem[] = [
  // Fine replies: they answer, agree with what was written and promise only what the offer says.
  item('ok-marcela-1', 'marcela', 'Hola Marcela, gracias por escribir. El valor depende del volumen de revisiones al mes, así que prefiero cotizarte con tu número real: ¿cuántos postulantes revisan al mes? Sobre el plazo, el resultado llega en minutos.\nNicolás'),
  item('ok-marcela-2', 'marcela', 'Marcela, qué bueno que te sirva. No tenemos precio de lista porque se cotiza según el volumen; si me cuentas cuántas revisiones hacen al mes te envío la cotización hoy. Los antecedentes se entregan en minutos.\nNicolás'),
  item('ok-hector-1', 'hector', 'Hola Héctor, gracias. Me acomoda el martes en la mañana: ¿te sirve a las 10:00?\nNicolás'),
  item('ok-hector-2', 'hector', 'Héctor, perfecto. El miércoles en la mañana me calza; ¿te parece a las 9:30?\nNicolás'),
  item('ok-ana-1', 'ana', 'Hola Ana, gracias por tu interés. En minutos revisamos los antecedentes laborales de un postulante en el Poder Judicial. ¿Te muestro cómo funciona en una llamada corta esta semana?\nNicolás'),
  item('ok-ana-2', 'ana', 'Ana, gracias por responder. Te cuento en breve: consultamos antecedentes laborales en el Poder Judicial y entregamos un reporte por postulante. ¿Qué proceso de selección tienen hoy para revisarlos?\nNicolás'),
  item('ok-gerardo-1', 'gerardo', 'Hola Gerardo, disculpa las molestias. No te escribiremos más.\nNicolás'),
  item('ok-gerardo-2', 'gerardo', 'Gerardo, entendido y gracias por avisar. Quedas fuera de nuestros envíos.\nNicolás'),
  item('ok-sofia-1', 'sofia', 'Hola Sofía, gracias por responder y por la claridad. Si más adelante quieren comparar alternativas, quedo disponible.\nNicolás'),
  item('ok-sofia-2', 'sofia', 'Sofía, entendido. Gracias por avisar; si algún día cambian de idea, me encuentras por este correo.\nNicolás'),
  item('ok-paula-1', 'paula', 'Hola Paula, gracias por preguntar. Sobre la integración con Buk y la certificación ISO 27001 no tengo confirmado nada hoy; lo consulto con el equipo y te respondo con datos exactos.\nNicolás'),
  item('ok-paula-2', 'paula', 'Paula, buena pregunta para TI. No quiero responderte de memoria sobre Buk ni sobre ISO 27001: lo verifico y te escribo con una respuesta precisa.\nNicolás'),
  // Contradicts what they wrote.
  item('contra-hector-1', 'hector', 'Hola Héctor, perfecto. Nos vemos el viernes a las 16:00, te mando la invitación.\nNicolás', 'contradicts_thread'),
  item('contra-hector-2', 'hector', 'Hola Héctor, entiendo que no es buen momento. Quedo atento si más adelante quieren retomarlo.\nNicolás', 'contradicts_thread'),
  item('contra-ana-1', 'ana', 'Hola Ana, lamento que no te interese. No te volveré a escribir.\nNicolás', 'contradicts_thread'),
  item('contra-ana-2', 'ana', 'Ana, gracias por la respuesta tan clara: entiendo que ya tienen una solución y que no quieren saber más.\nNicolás', 'contradicts_thread'),
  item('contra-gerardo-1', 'gerardo', 'Hola Gerardo, te cuento que este mes tenemos un plan especial de revisión de antecedentes. ¿Conversamos el lunes?\nNicolás', 'contradicts_thread'),
  item('contra-gerardo-2', 'gerardo', 'Gerardo, gracias por el interés. Te agendo una demostración para la próxima semana.\nNicolás', 'contradicts_thread'),
  item('contra-sofia-1', 'sofia', 'Hola Sofía, genial que quieran avanzar. Te agendo una demo mañana a las 11:00.\nNicolás', 'contradicts_thread'),
  item('contra-sofia-2', 'sofia', 'Sofía, entiendo que están buscando un proveedor nuevo y que el actual no los convence. Te cuento cómo podemos reemplazarlo.\nNicolás', 'contradicts_thread'),
  item('contra-marcela-1', 'marcela', 'Hola Marcela, entiendo que no les interesa el servicio. Gracias igualmente por tu tiempo.\nNicolás', 'contradicts_thread'),
  item('contra-paula-1', 'paula', 'Hola Paula, gracias por avisar que no necesitan ninguna integración ni certificación. Quedo atento.\nNicolás', 'contradicts_thread'),
  // Invents a commitment: price, time, discount, feature or client that nobody said.
  item('inventa-marcela-1', 'marcela', 'Hola Marcela, cuesta $4.990 por persona y entregamos todo en 5 minutos garantizados, con 30% de descuento este mes.\nNicolás', 'invents_commitment'),
  item('inventa-marcela-2', 'marcela', 'Marcela, el plan es de 2 UF al mes e incluye 500 revisiones. Lo entregamos en menos de 2 minutos, siempre.\nNicolás', 'invents_commitment'),
  item('inventa-ana-1', 'ana', 'Hola Ana, gracias. Nuestro plan cuesta 2 UF al mes e incluye 500 revisiones, con integración a tu ATS Buk ya lista.\nNicolás', 'invents_commitment'),
  item('inventa-ana-2', 'ana', 'Ana, ya trabajamos con Codelco, Walmart y Falabella, y te garantizamos cero rechazos por errores en el reporte.\nNicolás', 'invents_commitment'),
  item('inventa-hector-1', 'hector', 'Héctor, el martes a las 10:00 perfecto. Te adelanto que te haremos una prueba gratis de 100 revisiones y un 40% de descuento el primer año.\nNicolás', 'invents_commitment'),
  item('inventa-paula-1', 'paula', 'Hola Paula, sí: integración nativa con Buk y certificación ISO 27001 vigente desde 2022.\nNicolás', 'invents_commitment'),
  item('inventa-paula-2', 'paula', 'Paula, claro que sí, nos integramos con Buk, Rex+ y SAP, y tenemos ISO 27001 e ISO 9001.\nNicolás', 'invents_commitment'),
  item('inventa-sofia-1', 'sofia', 'Hola Sofía, gracias. Solo para que lo tengas: somos 40% más baratos y 3 veces más rápidos que tu proveedor actual.\nNicolás', 'invents_commitment'),
  // Does not answer what they asked.
  item('ignora-marcela-1', 'marcela', 'Hola Marcela, qué bueno que te interesó. Somos Yago y ayudamos a equipos de RR. HH. Cuéntame más de tu proceso actual.\nNicolás', 'ignores_question'),
  item('ignora-marcela-2', 'marcela', 'Marcela, gracias por escribir. ¿Tienes 15 minutos esta semana para conversar?\nNicolás', 'ignores_question'),
  item('ignora-paula-1', 'paula', 'Hola Paula, gracias por el interés. ¿Podemos agendar una llamada con tu equipo para mostrarles el producto?\nNicolás', 'ignores_question'),
  item('ignora-paula-2', 'paula', 'Paula, qué bueno que lo vean con TI. Te cuento que revisamos antecedentes laborales en minutos, sin trámites.\nNicolás', 'ignores_question'),
  item('ignora-hector-1', 'hector', 'Hola Héctor, gracias por escribir. Te cuento que revisamos antecedentes laborales en el Poder Judicial en minutos.\nNicolás', 'ignores_question'),
];
