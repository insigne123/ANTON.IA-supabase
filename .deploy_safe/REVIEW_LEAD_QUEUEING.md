# Revisión del Sistema de Cola de Leads

## ✅ Verificaciones Completadas

### 1. **Guardado de Leads con `mission_id`**
**Estado**: ✅ IMPLEMENTADO CORRECTAMENTE

En `src/app/api/cron/antonia/route.ts`, línea 162:
```typescript
mission_id: task.mission_id, // Link to mission
```

Todos los leads encontrados por una misión se guardan con su `mission_id` correspondiente.

### 2. **Scheduler Actualizado**
**Estado**: ✅ IMPLEMENTADO

El archivo `update_daily_scheduler.sql` contiene la lógica para:
- Verificar si hay leads pendientes (`status='saved'`) para cada misión
- Si hay leads pendientes → Crear tarea `ENRICH` (procesar cola)
- Si NO hay leads pendientes → Crear tarea `SEARCH` (buscar nuevos)

### 3. **Enriquecimiento desde Cola**
**Estado**: ✅ IMPLEMENTADO (con corrección)

En `executeEnrichment` (líneas 217-229):
- Detecta si debe leer desde la cola (`source: 'queue'`)
- Consulta la tabla `leads` filtrando por `mission_id` y `status='saved'`
- Respeta el límite diario (`capacity`)

**🔧 Bug Corregido**: Eliminé una verificación duplicada en línea 250 que impedía el procesamiento.

### 4. **Actualización de Estado**
**Estado**: ✅ IMPLEMENTADO

Después del enriquecimiento (líneas 298-306):
```typescript
await supabase
    .from('leads')
    .update({ 
        status: 'enriched',
        last_enriched_at: new Date().toISOString()
    })
    .in('id', leadIds);
```

Los leads procesados se marcan como `'enriched'` para no volver a procesarlos.

---

## 🔍 Puntos a Verificar en Base de Datos

### Ejecutar el Script de Verificación
He creado `verify_lead_queueing.sql` que verifica:

1. ✅ Columna `mission_id` existe en tabla `leads`
2. ✅ Índice `leads_mission_id_status_idx` creado
3. 📊 Conteo de leads por misión y estado
4. 📊 Leads recientes con `mission_id`
5. 📊 Misiones activas y sus leads pendientes
6. 📊 Tareas ENRICH creadas desde la cola
7. 📊 Leads sin `mission_id` (deberían ser antiguos)

### Ejecutar Migraciones Pendientes
Si aún no ejecutaste estos scripts en Supabase:

1. **`add_mission_id_to_leads.sql`** - Agrega columna `mission_id` e índice
2. **`update_daily_scheduler.sql`** - Actualiza función del scheduler

---

## 🎯 Flujo Completo Implementado

```
DÍA 1:
┌─────────────┐
│   SEARCH    │ → Encuentra 100 leads
└─────────────┘
       ↓
┌─────────────────────────────────┐
│ Guarda 100 leads con mission_id │
│ status = 'saved'                │
└─────────────────────────────────┘
       ↓
┌─────────────┐
│   ENRICH    │ → Procesa 10 (límite diario)
└─────────────┘
       ↓
┌─────────────────────────────────┐
│ Actualiza 10 leads:             │
│ status = 'enriched'             │
└─────────────────────────────────┘

Resultado: 90 leads quedan con status='saved'

DÍA 2:
┌──────────────────────────────┐
│ Scheduler verifica cola      │
│ Encuentra 90 leads pendientes│
└──────────────────────────────┘
       ↓
┌─────────────┐
│   ENRICH    │ → Procesa 10 más (desde cola)
└─────────────┘
       ↓
Resultado: 80 leads quedan con status='saved'

... y así sucesivamente hasta procesar todos
```

---

## 📋 Próximos Pasos

1. **Ejecutar migraciones SQL** en Supabase
2. **Ejecutar script de verificación** (`verify_lead_queueing.sql`)
3. **Probar con una misión real**:
   - Crear/activar una misión
   - Verificar que los leads se guardan con `mission_id`
   - Al día siguiente, verificar que se procesan desde la cola

---

## ⚠️ Nota Importante

La columna `organization_id` ya existe en la tabla `leads` (migración 20251203150000), así que los leads también se están guardando correctamente con el ID de organización.
