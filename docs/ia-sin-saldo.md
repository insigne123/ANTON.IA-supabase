# La IA sin saldo falla al tiro y lo dice como es (8 oct)

## Problema

El 8 oct la cuenta de OpenAI de las pruebas quedó sin créditos. OpenAI responde 429 con `insufficient_quota` y
`credit_balance_exhausted`. Ahí se vieron dos defectos que afectan al usuario si pasa con la cuenta de producción:

- **Espera inútil.** `generateStructuredWithTelemetry` (`src/ai/openai-json.ts`) trata todo 429 como saturación: reintenta 3 veces
  con espera y después prueba cada modelo de respaldo de la misma cuenta, que también fallan. Cada llamada hace esperar al usuario
  para nada, y un turno de Cowork tiene varias.
- **Mensaje falso.** Cowork decía «El servicio de IA está saturado. Reintenta en un minuto.» Reintentar no sirve, y el usuario cree
  que el problema es pasajero o suyo.

## Qué cambia

- `isProviderQuotaExhausted` reconoce la cuenta sin saldo (`insufficient_quota`, `credit_balance_exhausted`, `billing_hard_limit`,
  «exceeded your current quota»). Con ella no hay reintentos ni otro modelo: la llamada falla en el primer intento. Una saturación de
  verdad (`rate_limit_exceeded`) se sigue reintentando como antes.
- `failure-messages.ts` agrega la categoría `model_quota`: «El servicio de IA no está disponible por un problema de la cuenta de
  ANTON.IA con su proveedor, no por tu solicitud, y reintentar ahora no lo resuelve. Tu solicitud quedó guardada: avisa a soporte de
  ANTON.IA y reintenta cuando te confirmen que volvió.» No nombra al proveedor ni la facturación.
- El guion de llamada (`/api/ai/generate-phone-script`) devolvía el error crudo del proveedor, y el aviso del modal lo mostraba
  tal cual («OPENAI_HTTP_429:{…}»). Ahora usa `aiFailureMessage` (`src/lib/ai-failure-message.ts`): sin saldo, el mensaje de arriba
  y 503; otro error, «No se pudo generar el guion con IA. Reintenta en un momento.».
- La categoría sale en el log del worker (`[cowork] run failed`, `reason: model_quota`), así el equipo distingue «sin saldo» de «saturado».

## Verificación

- `openai-json.test.ts`: con dos modelos y 3 intentos, una cuenta sin saldo hace 1 sola llamada; una saturación no se confunde con
  falta de saldo.
- `failure-messages.test.ts`: el mensaje nuevo, sin «saturado» ni «un minuto».
- `ai-failure-message.test.ts`: nunca muestra el error del proveedor.

Sin migraciones ni flags.
