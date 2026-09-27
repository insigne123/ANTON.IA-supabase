# Cowork · inicio orientado a correo y LinkedIn (26 sep 2026)

## Qué cambia para el usuario

La pantalla de inicio de Cowork ahora muestra puntos de partida para lo que viene a hacer un usuario nuevo: escribir a sus contactos, LinkedIn, prospectos nuevos y cómo va. Antes eran pendientes, entregabilidad y un contacto con un «[nombre del contacto]» para completar. Ninguno llevaba a correo ni a LinkedIn.

| Botón | Lo que envía |
|---|---|
| Escribir a mis contactos | Prepara un correo sobre lo que vendo para mis contactos guardados que tienen correo y todavía no reciben nada. Muéstrame el correo y a quiénes iría. |
| ¿A quién le escribo hoy? | ¿A quién le escribo hoy? Prioriza a mis contactos con correo que aún no contacto y los seguimientos sin respuesta. |
| Invitar por LinkedIn | ¿A quién de mis contactos guardados con perfil de LinkedIn debería invitar esta semana? Revisa mi cupo de invitaciones. |
| Mejorar un correo | Mejora este correo para que sea más claro y fácil de responder: [pega aquí tu correo] |
| Buscar prospectos nuevos | Busca 10 prospectos nuevos en Chile que encajen con lo que vendo. |
| ¿Cómo voy? | ¿Cómo me ha ido esta semana con mis correos y campañas? Dame los números y qué conviene mejorar. |

- **Plantilla:** «Mejorar un correo» deja el texto en la caja con «[pega aquí tu correo]» seleccionado. La persona pega su correo y envía.
- **Botones que dependen de la oferta:** «Escribir a mis contactos» y «Buscar prospectos nuevos» no nombran rubro ni cargos. Salen de la oferta del usuario, que Cowork recibe en cada turno desde insigne123/ANTON.IA-supabase#7.
- **Texto bajo el saludo:** «Escribo correos y mensajes de LinkedIn para tus contactos, busco prospectos nuevos y te cuento cómo vas. Antes de enviar o cambiar algo te pido aprobación.»
- **Ejemplo de la caja de texto:** ahora es «escríbele a mis contactos que aún no contacto».

## Cómo se prueba cada botón

| Pieza | Dónde |
|---|---|
| Los seis puntos de partida, con `id`, ícono, título y texto | `src/lib/cowork/starters.ts` |
| La pantalla de inicio los muestra | `src/components/cowork/CoworkHome.tsx` |
| Un caso del corpus por botón, con el texto tal cual; la plantilla se completa con un correo de ejemplo | `STARTER_CORPUS` en `scripts/fixtures/cowork-marketing-corpus.ts` |
| La respuesta ideal de cada caso pasa todas sus verificaciones por el bucle real, sin modelo | `scripts/cowork-conversation-corpus.test.ts` |
| Pocos, cortos y con un solo lugar para completar | `src/lib/cowork/starters.test.ts` |

El corpus importa los textos de `starters.ts`. Si alguien cambia un botón, la evaluación mide el texto nuevo.

**Qué exige cada caso,** además de las 6 verificaciones comunes:
- **Escribir a mis contactos:**
  - revisa contactos y lo ya enviado;
  - muestra el correo firmado o propone la campaña;
  - solo para quienes tienen correo y nunca recibieron nada.
- **¿A quién le escribo hoy?:**
  - nombra al menos dos contactos;
  - no manda escribir por correo a quien no tiene correo.
- **Invitar por LinkedIn:**
  - revisa el cupo;
  - invita o nombra a alguien con LinkedIn;
  - no propone a quien no tiene LinkedIn.
- **Mejorar un correo:**
  - entrega la versión nueva, firmada y concreta con la oferta.
- **Buscar prospectos nuevos:**
  - propone 10 personas en Chile, con cargos de quien compra la oferta (RR. HH.);
  - no pregunta qué vende el usuario.
- **¿Cómo voy?:**
  - consulta resultados;
  - da los números reales (1 correo enviado).

## Validación

**Modelo real** (gpt-6-luna, bucle real, lecturas de fixture, 3 repeticiones): **18/18** casos, 171/171 verificaciones y 12/12 respuestas con pregunta final y sugerencias. En promedio, 1,7 consultas y 1,9 llamadas por caso.

La primera lectura dio 16/18: «Escribir a mis contactos» falló dos veces. Leyendo las respuestas, las tres eran correctas: dejaban fuera a Marcela porque ya había recibido un correo («Excluí a Marcela Rojas porque aparece un envío registrado»). La verificación solo reconocía algunas formas de decirlo. Se corrigió para aceptar «excluí», «dejé fuera» o «ya tiene un envío registrado», y sigue rechazando incluirla.

**Navegador** (Playwright contra el build de producción local, con un Supabase simulado solo en local):
- Escritorio claro y oscuro (1280 px) y teléfono (390 px): los seis botones se ven sin scroll horizontal.
- Al tocar «Mejorar un correo», la caja recibe el foco con el texto y «[pega aquí tu correo]» seleccionado.
- No se envió nada.

Cómo se corre la evaluación de los botones:

```
OPENAI_API_KEY=… COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=80 --repeat=3 --cases=inicio-escribir,inicio-a-quien,inicio-linkedin,inicio-mejorar,inicio-prospectos,inicio-como-voy
```

## Pendientes

- **Teléfono:** los seis botones quedan uno bajo otro, igual que los seis anteriores. Si se quiere menos altura, se puede mostrar cuatro en pantallas chicas.
- **Acciones rápidas dentro de una conversación:** hoy siguen siendo las respuestas sugeridas de cada turno (insigne123/ANTON.IA-supabase#3). Los puntos de partida solo están en el inicio.
