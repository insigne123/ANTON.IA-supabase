# Oportunidades: «Recordarme» con Outlook (Microsoft 365)

**Fecha:** 22 de octubre de 2026.

## Por qué

En la demo del 21 de octubre, GrupoExpro vio que «Recordarme» solo agregaba las fechas del informe a Google Calendar y que su calendario de trabajo es el de Microsoft. Se acordó pasar a Microsoft Calendar «en lugar de» Google. Hoy el único lugar de la app con un calendario es ese menú: no hay conexión con ningún calendario, solo un enlace que abre el formulario de un evento (`docs/oportunidades-informe-ajustes.md`, punto 3).

## Qué cambia

- **El menú pregunta «Mi calendario».** Dos botones: **Outlook (Microsoft 365)**, que queda elegido por defecto, y **Google Calendar**. La elección se recuerda en este navegador (`anton:reminder-calendar`); sin ella el menú funciona igual.
- **Un solo botón por fecha**, con el calendario elegido: «Agregar a Outlook (Microsoft 365)», o en «Recordatorios de todas» una fila por fecha. Se mantiene «Descargar todas juntas (.ics)», que sirve en cualquier calendario.
- **El evento es el mismo en ambos** (`report-marks.ts`): queda en el momento del aviso que la persona eligió («en 3 días»), dura media hora y dice qué fecha anuncia y de qué compra es (nombre, organismo, ID, enlace a ANTON.IA y a la ficha oficial). Ninguno de los dos enlaces puede llevar una alarma; el `.ics` sí.
- **Cómo abre Outlook:** `outlookCalendarUrl` arma `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=…&startdt=…&enddt=…&body=…&location=…`, con las fechas en UTC (Outlook las muestra en la hora de la persona). Abre el formulario del evento ya lleno y la persona lo confirma: no se lee ni se escribe nada en su calendario, y no hace falta que la organización autorice nada en Microsoft.
- Manual de ayuda.

## Qué no hace

- **No es una sincronización.** No lee el calendario, no crea eventos solo ni los actualiza si cambia la fecha de la licitación. Una conexión de verdad (Microsoft Graph, `Calendars.ReadWrite`) pide que cada cuenta vuelva a autorizar con permisos nuevos y que un administrador del tenant de Microsoft los apruebe en muchas empresas; no se hizo sin que alguien lo pida.
- **Cuentas personales de Outlook.com.** El enlace es el de Microsoft 365 (trabajo o estudio). Una cuenta personal puede usar «Descargar (.ics)».
- **No se probó contra una cuenta Microsoft real:** el formato del enlace sigue el que usan otros sitios para «agregar al calendario», pero Microsoft no lo documenta. Si Outlook rechazara algún parámetro, lo seguro es el `.ics`. Está por probar con la cuenta de GrupoExpro: cómo se ven los saltos de línea de la descripción y que la hora quede en Chile.

## Pruebas

- `report-marks.test.ts`: el enlace de Outlook (ruta, parámetros, mismo momento y duración que el de Google, UTC, saltos de línea, título y lugar, recorte) y la elección por nombre.
- `report-interactive-ui.test.ts`: Outlook elegido por defecto, Google a un toque, una fila por fecha con el calendario elegido y el nombre y el ID del evento.
