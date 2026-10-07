# Cowork · ofrece recordar lo que se dice de pasada (Plan 14, 4)

Cuarta mejora de comportamiento del Plan 14. Odysseus (de PewDiePie) y ChatGPT aprenden solos los datos durables de una conversación. Cowork guarda solo lo que la persona aprueba (Plan 12, 5), pero se perdía lo que no se pedía con «recuerda que…».

## Qué cambia

- **Una instrucción permanente dicha de pasada** recibe una respuesta sugerida «Recordarlo para la próxima», en cualquier respuesta y no solo junto a la Redactora:
  - «siempre firma como Nico»;
  - «nunca uses emojis»;
  - «nunca le escribimos a empresas de seguridad privada»;
  - «no trabajamos con el sector público».
- **Tocarla envía «Recuerda que …»**: Cowork propone la tarjeta y nada se guarda sin aprobación, como siempre.
- **No aparece:**
  - si Cowork ya lo recuerda;
  - si ya hay una sugerencia de recordar;
  - si el turno propuso algo;
  - si las preferencias están apagadas.
- **No cuentan:**
  - un pasado («nunca tuvimos respuesta»);
  - una pregunta («¿siempre les escribo?»);
  - lo de una vez («esta vez, en tono formal»).

## Cómo funciona

- `coworkStandingPreference` (`src/lib/cowork/preference-proposal.ts`) busca «siempre», «nunca» o «jamás» antes de un verbo de una lista cerrada de cómo escribir o a quién contactar, o «no trabajamos / vendemos / atendemos con…». Corta la cláusula antes de una pregunta.
- `coworkPreferenceSuggestion` la convierte en la respuesta sugerida, salvo que las memorias ya la tengan.
- `runCoworkReadLoop` la agrega a toda respuesta sin propuesta. Junto a la Redactora sigue funcionando como antes.

## Medición

Luna, corpus de preferencias, 2 repeticiones:

| | main | este PR |
|---|---|---|
| Casos que ya existían (5) | 88/88 | 88/88 |
| Chip de recordar en esos casos | solo en `pref-con-tarea` | solo en `pref-con-tarea` |
| Casos nuevos `pref-de-pasada` y `pref-de-pasada-chat` | — | 36/36, con el chip correcto |

## Rollback

`git revert` del PR, o `COWORK_PREFERENCES_ENABLED=false`, que apaga todas las preferencias.
