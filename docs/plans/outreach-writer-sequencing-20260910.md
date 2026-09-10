# Escritor de correos y secuencias — 10 de septiembre de 2026

## Qué cambia

- El redactor elige una estrategia antes de escribir: hecho primario por
  relevancia (cargo, oferta, ancla del reporte, confianza), capacidad del
  vendedor que conecta y encuadre exploratorio cuando no hay puente real.
- Biblioteca de ejemplos de estructura y tono adaptada del playbook propio.
  Los ejemplos nunca aportan hechos, cifras ni clientes.
- Cuerpo flexible (apertura + valor, bullets con ·), presupuestos 60–150
  palabras en inicial y 30–90 en seguimientos. Saludo y CTA los sigue
  agregando el servidor. Versión del prompt: `native-draft/v10`.
- El preflight exige la conexión comercial en los bloques que mencionan al
  vendedor, para que el ancla no preste relevancia a una oferta ajena.
- Secuencia editable bajo el correo inicial: botón + para agregar (máx. 4),
  quitar pasos, días hábiles por paso (1–30), cadencia del playbook
  (días 4, 9, 14, 19) e hilo (el primer seguimiento responde el hilo
  inicial en Gmail; el resto abre hilo nuevo).
- Interruptor de envío automático: solo envía versiones aprobadas, de lunes
  a viernes (America/Santiago), y se detiene ante respuesta, baja o rebote.
  El correo inicial siempre se envía manualmente.

## Migración requerida (una sola, forward-only)

`supabase/migrations/20260911110000_campaign_v2_sequencing_auto_send.sql`

- Activa `feature_campaigns_v2_enabled` en todas las organizaciones.
- `update_first_contact_plan_steps_v2`: reemplaza pasos antes del envío
  inicial (archiva borradores auto-generados eliminados, no borra nada del
  usuario).
- `claim_due_campaign_v2_auto_steps_v2`: expone pasos aprobados y vencidos
  de campañas con `auto_send` para el worker, con `SKIP LOCKED` y clave de
  idempotencia determinista `campaign-v2:auto:{paso}:{versión}`.

Aplicar desde el SQL editor del dashboard de Supabase (producción
`yfdelflsheurzaicwayi`) y verificar: `select * from
supabase_migrations.schema_migrations order by version desc limit 5;`
debe incluir `20260911110000`. Sin esta migración, la edición de secuencia
y el envío automático devuelven un error honesto; el resto sigue igual.

## Validación realizada

- Suite principal: 1223 pruebas aprobadas, cero fallos.
- Compilación Next.js con tipos y lint aprobados.
- Navegador con API simulada: campañas y búsqueda por empresas aprobadas.
- Evaluación dorada: correo estilo plantilla pasa el firewall; identidad
  sustituida pierde relevancia; cifra inventada se rechaza.

## Pendiente

- Aplicar la migración y desplegar esta versión.
- Prueba autenticada de punta a punta: crear secuencia, aprobar, activar
  envío automático y confirmar el primer envío programado.
