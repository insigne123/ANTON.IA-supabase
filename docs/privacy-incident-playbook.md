# Privacy incident playbook

Objetivo:
Tener una respuesta simple y repetible si ocurre una exposicion, perdida o acceso no autorizado a datos personales.

Que es un incidente:
- Cualquier evento que pueda comprometer confidencialidad, integridad o disponibilidad de datos personales.
- Ejemplos: fuga de token, exportacion indebida de leads, acceso no autorizado, envio accidental a tercero, filtracion en logs.

## 1. Primeros 30 minutos

1. Confirmar si el incidente sigue activo.
2. Contener: revocar token, desactivar integracion, cerrar acceso o aislar feature si hace falta.
3. Guardar evidencia minima: fecha, sistema afectado, usuario o organizacion impactada, tipo de dato.
4. Avisar al responsable interno designado por YAGO SPA.

Efecto:
- Evita que el problema siga creciendo.
- Permite investigar sin perder evidencia.

## 2. Primera evaluacion

Preguntas base:
1. Que datos estuvieron expuestos?
2. Cuantas personas u organizaciones pueden estar afectadas?
3. El acceso fue real o solo potencial?
4. El incidente involucra credenciales, emails, tracking, leads, replies o integraciones?
5. Hay proveedor externo comprometido?

Efecto:
- Permite dimensionar gravedad y decidir siguientes pasos.

## 3. Clasificacion simple

### Baja
- Evento limitado, sin evidencia clara de acceso real, con contencion rapida.

### Media
- Exposicion acotada de datos operativos o comerciales con impacto probable manejable.

### Alta
- Exposicion relevante de credenciales, listas de leads, contenido de mensajes, tracking o datos de multiples organizaciones.

Efecto:
- Ayuda a priorizar recursos y tiempos de respuesta.

## 4. Acciones de contencion recomendadas

1. Rotar secretos o tokens.
2. Deshabilitar workflows o integraciones afectadas.
3. Limitar accesos por organizacion o usuario.
4. Forzar logout si el problema toca sesion o autenticacion.
5. Revisar logs y actividad relacionada.

## 5. Registro minimo del incidente

- Fecha y hora.
- Detector del evento.
- Sistemas afectados.
- Datos afectados.
- Organizaciones o usuarios potencialmente impactados.
- Acciones de contencion aplicadas.
- Estado actual.
- Responsable interno.

Efecto:
- Deja trazabilidad para auditoria, aprendizaje y decision legal posterior.

## 6. Cierre y mejora

1. Identificar causa raiz.
2. Definir que cambio tecnico o operativo evita repeticion.
3. Registrar fecha de cierre.
4. Actualizar politica, control o configuracion si hacia falta.

Efecto:
- Convierte un incidente en una mejora permanente del sistema.

## Pendientes siguientes

1. Nombrar owner formal del playbook.
2. Agregar lista de contactos internos y externos.
3. Definir criterios finales de escalamiento legal.
4. Integrar este playbook con monitoreo tecnico y activity logs.
