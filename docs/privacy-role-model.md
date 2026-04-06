# Privacy role model

Objetivo:
Tener una primera matriz simple para decidir cuando YAGO SPA actua como responsable, encargado o en un modelo mixto dentro de ANTON.IA.

Que significa cada rol:
- Responsable: decide para que y como se usan los datos.
- Encargado: procesa datos por instruccion del cliente.
- Mixto: en una misma funcion hay partes donde YAGO SPA actua como encargado y otras donde define medios o fines propios.

## Matriz inicial

### 1. Cuentas de usuario de la plataforma
- Rol tentativo: responsable.
- Por que: YAGO SPA define autenticacion, seguridad, sesiones, soporte y operacion del producto.
- Efecto: YAGO SPA debe informar claramente este tratamiento y gestionarlo como propio.

### 2. Datos de organizaciones cliente
- Rol tentativo: responsable.
- Por que: YAGO SPA administra organizacion, permisos, billing operativo y configuracion base del servicio.
- Efecto: este bloque cae del lado propio del SaaS, no solo por instruccion del cliente.

### 3. Leads cargados, guardados o trabajados por el cliente
- Rol tentativo: mixto.
- Por que: el cliente define a quien prospectar y con que finalidad comercial, pero YAGO SPA define parte del producto, modelos, almacenamiento y automatizacion.
- Efecto: no conviene asumir que todo este bloque es solo de encargado.

### 4. Busqueda y enrichment con proveedores externos
- Rol tentativo: mixto con riesgo de responsable en parte del flujo.
- Por que: si el producto propone, orquesta, combina o enriquece datos con logica propia, YAGO SPA participa activamente en la forma del tratamiento.
- Efecto: se necesita documentacion mas fuerte y cuidado especial en transparencia y base legal.

### 5. Envio de correos por instruccion del usuario
- Rol tentativo: mayormente encargado en la operacion del envio, con responsabilidades propias de seguridad y plataforma.
- Por que: el cliente decide destinatarios y contenido comercial, pero YAGO SPA provee la infraestructura funcional.
- Efecto: conviene cubrir esto en contratos y en politica publica.

### 6. Tracking, bajas y exclusiones
- Rol tentativo: mixto.
- Por que: el cliente usa estos datos para outreach, pero YAGO SPA debe mantener exclusiones y seguridad del sistema.
- Efecto: YAGO SPA necesita reglas propias para no reenviar a excluidos.

### 7. IA, scoring y recomendaciones
- Rol tentativo: responsable o mixto segun configuracion final.
- Por que: si YAGO SPA define scoring, fit, prioridades o automatizacion, no esta actuando solo por instruccion mecanica del cliente.
- Efecto: este es uno de los bloques mas sensibles y debe tener disclosure claro.

### 8. Logs, auditoria y monitoreo
- Rol tentativo: responsable.
- Por que: son necesarios para operar, proteger y mejorar el servicio.
- Efecto: YAGO SPA puede justificar estos tratamientos como parte de seguridad y soporte del producto.

## Conclusiones simples

1. No es recomendable tratar toda la app como si YAGO SPA fuera solo encargado.
2. En usuarios, seguridad, sesiones, auditoria e infraestructura, YAGO SPA actua claramente como responsable.
3. En leads, outreach y enrichment, el escenario mas realista hoy es mixto.
4. Mientras mas scoring, IA y automatizacion propia tenga ANTON.IA, mas dificil es sostener una postura de mero encargado.

## Siguiente decision pendiente

1. Validar esta matriz con asesoria legal.
2. Traducir el modelo final a politica publica y contratos.
3. Identificar que pantallas o features requieren un disclaimer mas especifico.
