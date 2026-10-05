# Email Studio Notes

## Tipo de problema

- componente: chat conversacional
- componente: preview de email
- flujo: personalizacion asistida por agente
- sistema visual: workspace premium dentro de settings

## Referencias usadas

### Unsection

- patrones de hero editorial y bloques de valor
- mejor ritmo vertical en la entrada de la pagina
- uso de una segunda columna estrategica, no solo decorativa

### Figcomponents

- dashboards y sidebars para organizar paneles
- chat components para mejorar sensacion de producto
- settings/dashboard previews para encapsular controles

### Skills

- `frontend-design` para direccion estetica premium
- `ui-ux-pro-max` para jerarquia, spacing, accesibilidad y polish
- `web-design-guidelines` para futuras auditorias de consistencia

## Proximas mejoras recomendadas

- diff visual antes vs despues
- score de calidad del correo
- presets por estrategia comercial
- panel avanzado real con snippets, bloques y libreria reusable

## Rediseño de «Firmas y estilo» (Plan 11, PR 3b)

**Pantalla:** dos pestañas, «Firma» y «Estilos».
- `?tab=firma|estilos` abre una directamente; si no viene, se abre la última usada y, la primera vez, «Firma».
- Las dos quedan montadas, así que cambiar de pestaña no pierde lo que se está editando.

**«Firma».** `SignatureBuilder` usa `src/lib/email-studio/signature-builder.ts`.
- **Diseños:** Clásica, Con logo, Compacta e Imagen. Este último usa una imagen de firma que ya tengas, en PNG o JPG de hasta 2 MB.
- **Datos:** nombre, cargo, empresa, teléfono, sitio y LinkedIn; vienen del perfil.
- **El HTML:**
  - usa tablas y estilos en línea, que Gmail y Outlook dibujan bien;
  - escapa cada valor;
  - acepta solo enlaces https y tel;
  - pasa por la limpieza del envío (`sanitizeSendSignature`, PR 3a) sin perder nada. Lo prueba `signature-builder.test.ts`.
- **Cuentas:** por defecto, una sola firma para Gmail y Outlook. Se puede separar por cuenta.
- **Qué se guarda:** en `profiles.signatures.{gmail|outlook}`, junto con `builder: { design, fields }`, para poder volver a editarla.
- **Al enviar:** el servidor la agrega a cada envío solo con «Usar al enviar» encendido (PR 3a).
- **Vista previa:** se dibuja sobre fondo blanco a propósito, porque es como la ve quien recibe el correo.

**«Estilos».**
- **Galería de tarjetas:** cada una con su insignia («Predeterminado», «Equipo» o «Personal»). Duplicar, publicar para el equipo y archivar están en el menú «Más» de cada tarjeta.
- **«Crear estilo» en 3 pasos:**
  1. punto de partida;
  2. tono y largo, con chips;
  3. «En tus palabras»: la guía, el ajuste con IA, y el asunto y el correo base.
- **Variables:** las pastillas «Insertar» escriben `{Nombre}` o `{Empresa}` donde está el cursor.
  - Se guardan como `{{lead.firstName}}` y `{{company.name}}`, que es lo que rellenan los borradores (`src/lib/email-studio/variables.ts`).
  - La sintaxis antigua `[[…]]` se sigue leyendo y se guarda como `{{…}}`.
- **«Dónde se usa»:** enlaza a Redactar, Campañas y Cowork. El predeterminado se usa solo cuando nadie elige otro.
- **Vista previa:**
  - usa un contacto investigado real, si hay;
  - termina con la firma guardada, que se recarga al guardarla en «Firma».
  - **Sin firma:** el aviso lleva a «Firma».

**Redactar.**
- Junto a «Enviar» dice si el correo sale con tu firma o sin ella, con un enlace para cambiarla.
- Bajo «Perfil de estilo» hay un enlace para crear o editar estilos.
