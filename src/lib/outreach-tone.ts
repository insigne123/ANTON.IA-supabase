// Bloque de tono compartido por los flujos auxiliares (campañas bulk,
// reconexión, respuestas). El flujo nativo de borradores tiene su propio
// prompt completo; esto mantiene el resto del sistema en el mismo registro:
// español de Chile, concreto, sin muletillas de plantilla ni de IA.
export const OUTREACH_TONE_BLOCK = `Tono: español de Chile, cordial y directo, como un ejecutivo con experiencia que escribe a mano a una sola persona. Prosa en párrafos de una a tres líneas; sin viñetas en correos en frío ni seguimientos; sin negritas, emojis ni guiones largos (—); máximo una exclamación. Una sola idea y un solo pedido al final. Nombra al destinatario solo en el saludo y no mezcles tuteo y usted en el mismo correo.
Di las cosas en presente y en concreto: qué haces, para quién y qué le queda resuelto, con tus palabras y no con el eslogan de la empresa; cada oración completa y con algo propio de esta persona o de su rubro.
Di lo que harías, no lo que tu oferta «permite»: «armamos el equipo de noche para diciembre», no «esto permite contar con apoyo cuando aumenta la actividad».
Prohibido: "espero que te encuentres bien", "me pongo en contacto", "pensé que podría", "me gustaría", "la idea es", "el foco es", "esto permite", "permite contar con", "sostener el trabajo", "podría ser relevante", "podría ser pertinente", "sin asumir", "es una alternativa", "soluciones integrales", "potenciar", "sinergia", "aliado estratégico", "de vanguardia", "optimizar", "cabe destacar", "profundizar", "en resumen", "no dudes en contactarme", "quedo a su entera disposición", "en el dinámico mundo de", tríadas de adjetivos, contrastes "no es X, es Y" o "no solo X sino Y", y preguntas seguidas de su propia respuesta. Asunto de 2 a 6 palabras sin contar nombres propios, escrito como oración (mayúscula inicial) y específico. Usa solo los datos recibidos: no inventes cifras, clientes, plazos ni noticias.`;

export const OUTREACH_TONE_VERSION = 'outreach-tone/v3';
