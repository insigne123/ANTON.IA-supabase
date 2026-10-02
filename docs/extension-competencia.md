# Extensión de LinkedIn: qué hace la competencia (Plan 8, fase 4)

Comparación de 2 oct 2026 con las extensiones de prospección más usadas. Sirve para elegir qué sumar a la extensión de Anton.IA. Describe funciones públicas de cada producto; no copia su marca, iconos ni textos.

## Qué aporta cada una

| Extensión | Lo que hace en LinkedIn |
|---|---|
| Apollo | Revela correos y teléfonos, guarda en lote desde búsquedas y listas, y suma a secuencias |
| Lusha | Panel lateral con correo y teléfono al instante |
| Surfe | Muestra el CRM sobre el perfil: si existe y quién es su dueño |
| Kaspr | Revela datos de contacto con un clic |
| Evaboot | Exporta listas de Sales Navigator, limpias |
| Waalaxy y Dux-Soup | Automatizan invitaciones y mensajes |
| Crystal | Sugiere cómo escribirle a cada persona según su estilo |

## Lo que Anton.IA ya tenía

- **Investigación con informe:** fuentes de la empresa y de la persona, y un PDF.
- **Mensajes con IA,** con la oferta de la organización.
- **Envío asistido:** el texto queda listo en LinkedIn, o se envía con confirmación y sin reenvíos.
- **Equipo:** campañas de correo, trabajos aprobados en Cowork y bloqueos de equipo.

## Lo que faltaba, y en qué PR entra

| Función | Cómo la tiene la competencia | PR |
|---|---|---|
| Orden claro, con el paso siguiente a la vista | Lusha y Apollo: una ficha de la persona con la acción principal arriba | PR-4a (`docs/extension-panel.md`) |
| Marca en cada perfil: guardado, contactado, quién lo trabaja | Surfe: el estado del CRM sobre el perfil | PR-4b |
| Guardar en lote desde búsquedas y listas | Apollo y Evaboot | PR-4c |
| Ficha de empresa con sus contactos y decisores | Apollo | PR-4d |
| Abrir la conversación desde su actividad reciente | Crystal, en parte: personaliza por el perfil | PR-4e |

## Lo que no se hace, a propósito

- **Automatización masiva** (Waalaxy, Dux-Soup):
  - LinkedIn la prohíbe y arriesga la cuenta de la persona;
  - Anton.IA mantiene el envío con confirmación, de a uno.
- **Revelar datos sin costo visible:** buscar correo o teléfono usa créditos, y el panel lo dice antes.

## Después

Un panel en Gmail, como Apollo y Lusha, para ver el contacto y su historial al leer un correo.
