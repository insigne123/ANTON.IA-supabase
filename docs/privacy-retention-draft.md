# Privacy retention draft

Objetivo:
Definir una politica inicial de conservacion de datos sin cambiar aun el comportamiento de la app.

Que significa retencion:
- Es el tiempo maximo en que un tipo de dato deberia mantenerse antes de borrarse, anonimizarse o revisarse.
- Su efecto es reducir riesgo legal, riesgo de brecha y acumulacion innecesaria.

## Regla general

- Mantener solo lo necesario para operar la plataforma, dar soporte, proteger el servicio y respetar bajas o exclusiones.
- Cuando un dato deja de ser necesario, deberia eliminarse o anonimizarse.

## Propuesta inicial por categoria

### 1. Cuentas de usuario
- Propuesta: mientras la cuenta este activa y hasta 12 meses despues de cierre para soporte, auditoria o cobro, salvo obligacion mayor.
- Efecto: permite cierre ordenado sin guardar cuentas para siempre.

### 2. Tokens de integracion
- Propuesta: mientras la integracion este activa. Borrar al desconectar o revocar, con limpieza periodica de conexiones obsoletas.
- Efecto: reduce exposicion de credenciales innecesarias.

### 3. Leads no trabajados o no convertidos
- Propuesta: revision a los 6 meses y purga o archivo a los 12 meses si no tuvieron actividad util.
- Efecto: evita guardar bases de prospectos indefinidamente.

### 4. Leads contactados y tracking comercial
- Propuesta: mantener mientras exista relacion comercial activa; revisar a los 12 meses sin actividad y depurar a los 24 meses, salvo lista de baja.
- Efecto: conserva historial util pero pone limite temporal.

### 5. Bajas y exclusiones
- Propuesta: mantener mientras sea necesario para impedir nuevos envios no deseados.
- Efecto: protege cumplimiento aun despues de borrar otros datos.

### 6. Logs tecnicos y auditoria
- Propuesta: 90 a 180 dias para logs tecnicos generales; auditoria funcional critica hasta 12 meses segun necesidad operativa.
- Efecto: conserva trazabilidad suficiente sin sobreretener datos tecnicos.

### 7. Datos enviados a IA o workflows externos
- Propuesta: minimizar origen; revisar si el proveedor guarda datos y alinear retencion contractual o tecnica.
- Efecto: evita perder control sobre retencion en terceros.

## Antes de automatizar borrado

1. Confirmar impacto comercial por tipo de dato.
2. Confirmar si algun cliente exige plazos distintos por contrato.
3. Confirmar si ciertos datos deben bloquearse en vez de borrarse de inmediato.

## Siguiente implementacion tecnica futura

1. Agregar campos de review o expiry por categoria.
2. Crear jobs de limpieza o anonimizado.
3. Separar tablas que deben conservar bajas de las que pueden purgarse.
