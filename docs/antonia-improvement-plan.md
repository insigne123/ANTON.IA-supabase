# Plan de mejoras y arreglos ANTON.IA

## Objetivo

Reducir fricción para el usuario final, simplificar la configuración de ANTONIA y corregir los desajustes operativos que hoy afectan campañas, leads, CRM, métricas y cron.

## Prioridades

### P0 - Operación real y confianza del sistema

- Unificar la definición de "lead respondido" entre `contacted_leads`, vistas de contactados y métricas de ANTONIA.
- Verificar cron productivo con `CRON_SECRET`, `dryRun`, últimos `last_run_at` y logs.
- Corregir estados eternos de `pending_phone` en leads enriquecidos.

### P1 - Simplificación del producto

- Sacar `Autopilot` como concepto separado del flujo principal y llevarlo al proceso de creación/configuración de misión.
- Dejar solo decisiones simples para el usuario:
  - activar automatización
  - elegir nivel de autonomía
  - definir política de aprobación
- Mantener controles avanzados solo donde aporten valor real.

### P2 - UX y productividad

- Reordenar UX de campañas y quitar avisos persistentes que distraen.
- Agregar filtros útiles en `Sheet`.
- Agregar filtros completos en `Leads guardados`.
- Mejorar la UX de `Leads enriquecidos` y de estados de teléfono.

### P3 - Automatización comercial

- Automatizar movimiento del pipeline CRM según eventos reales:
  - contacto enviado -> `contacted`
  - reply positivo -> `engaged`
  - meeting request -> `meeting`
  - negativo / unsubscribe -> `closed_lost`

## Cambios concretos por área

### 1. Configuración y misión

- Integrar controles esenciales de automatización dentro del wizard de misión.
- Reemplazar bloques duplicados de settings por una configuración más corta y comprensible.
- Añadir copy explicativa simple para `Manual Assist`, `Semi Auto` y `Full Auto`.

### 2. Cron y scheduler

- Mantener verificación técnica con:
  - `vercel.json`
  - `/api/cron/antonia?dryRun=1`
  - `/api/cron/process-campaigns?dryRun=1`
- Incorporar script local para comprobar autorización, estado del cron y worker de campañas.

### 3. Campañas

- Reubicar acciones de crear campaña cerca del listado/filtros.
- Quitar el aviso fijo del motor automático.
- Revisar claridad entre seguimiento y reconexión.

### 4. Sheet

- Agregar filtro por industria.
- Agregar filtro por fecha de ingreso al CRM usando la mejor fecha disponible del lead/fila.

### 5. Leads guardados

- Agregar filtros por:
  - industria
  - fecha de ingreso
  - persona que lo ingresó
  - empresa
  - cargo
- Mejorar cabecera de filtros para que sea más limpia y rápida de usar.

### 6. Leads enriquecidos

- Revisar sincronización de teléfonos pendientes y cerrar estados viejos sin resultado.
- Hacer más claro cuándo un teléfono está:
  - en proceso
  - no encontrado
  - listo

### 7. Métricas y respuestas

- Alinear dashboards y tablas para usar la misma lógica de respuestas reales.
- Verificar el flujo `tracking webhook -> clasificación -> CRM -> métricas`.
- Reparar históricos donde `contacted_leads.status` no coincide con `replied_at` o con fallas de entrega.

## Scripts operativos agregados

- `npm run verify:antonia-cron`
  - Verifica autorización y `dryRun` del cron principal y del cron de campañas.
- `npm run repair:contacted-history`
  - Revisa en modo seguro inconsistencias históricas en `contacted_leads`.
- `npm run repair:contacted-history -- --write`
  - Corrige estados históricos para que replies reales queden en `replied` y fallas de entrega en `failed`.
- `npm run repair:crm-pipeline-history`
  - Revisa en modo seguro si el pipeline CRM histórico quedó desalineado respecto a replies, meeting requests y delivery failures.
- `npm run repair:crm-pipeline-history -- --write`
  - Corrige columnas y señales automáticas del CRM histórico en `unified_crm_data`.
- `npm run verify:linkedin-profile`
  - Valida una búsqueda real por perfil de LinkedIn con `reveal_email` + `reveal_phone`.
  - Requiere `LINKEDIN_PROFILE_TEST_USER_ID` y `LINKEDIN_PROFILE_TEST_URL` en `.env.local`.

## Orden recomendado de ejecución

1. Cron y métricas reales.
2. Simplificación de autopilot/misión.
3. Campañas UX.
4. Filters de Sheet y Leads guardados.
5. Pending phone y UX de enriquecidos.
6. Automatización completa del pipeline CRM.

## Notas de implementación

- Evitar agregar más configuraciones avanzadas visibles si no son necesarias para el usuario final.
- Priorizar copy claro, defaults razonables y menos decisiones manuales.
- Tratar `autopilot` como una capacidad interna de automatización, no como un módulo separado para el usuario.
