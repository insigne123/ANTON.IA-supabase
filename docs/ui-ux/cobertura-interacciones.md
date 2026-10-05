# Cobertura de interacciones

Qué se probó de cada pantalla además de su vista quieta, qué salió y qué se hizo con cada hallazgo (Plan 11, sección 1). La herramienta es `npm run audit:interactions` y su método está en `scripts/visual-audit/README.md`, sección «Recorrido de interacciones». Corre sobre el banco de la auditoría visual: Supabase simulado, sin red y sin envíos.

## Qué se cubre

Cada página se recorre en dos ejes: lo que la persona hace (interacción) y lo que le pasa a la app (estado).

| Interacción o estado | Qué se comprueba | Personas |
|---|---|---|
| Menús, diálogos, hojas, selectores y desplegables | Se abren; el foco entra; axe pasa; Esc los cierra; el foco vuelve; abrirlos no escribe datos | owner y member |
| Pestañas | Clic y flechas eligen la pestaña y muestran su panel | owner y member |
| Teclado | 16 paradas de Tab con el foco visible | owner y member |
| Lecturas que fallan (500) | La página avisa: no se rompe, no queda en blanco, no dice «vacío» | owner |
| Lecturas lentas (3 s) | Mientras espera se ve que carga | owner |
| Textos 3 veces más largos | Nada desborda | owner |

En la primera corrida hubo 57 visitas (33 páginas como owner y 24 como member):

- se abrieron 123 menús y diálogos;
- se probaron 11 pestañas;
- se recorrieron 643 paradas de foco.

El member no ve las páginas con lista de acceso (Cowork, Oportunidades, Privacidad y Administración), igual que en la app.

### Matriz por página

Columnas: menús y diálogos abiertos, pestañas y paradas de foco (owner / member); error, lento y largo (owner).

| Página | Menús y diálogos | Pestañas | Paradas de foco | Error | Lento | Largo |
|---|---:|---:|---:|---|---|---|
| Inicio `/` | 0 / 0 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Búsqueda `/search` | 4 / 3 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Por completar `/saved/leads` | 2 / 1 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Por escribir `/saved/leads/enriched` | 28 / 14 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Importar contactos `/leads/import` | 0 / 0 | 0 / 0 | 3 / 3 | sí | sí | sí |
| Empresas guardadas `/saved` | 0 / 0 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Investigaciones `/research` | 0 / 0 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Conversaciones `/contacted` | 2 / 1 | 0 / 0 | 11 / 11 | sí | sí | sí |
| Pipeline `/crm` | 8 / 4 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Tabla de datos `/sheet` | 4 / 2 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Campañas `/campaigns` | 0 / 0 | 2 / 2 | 6 / 5 | sí | sí | sí |
| Historial de campañas `/campaigns/history` | 0 / 0 | 0 / 0 | 9 / 9 | sí | sí | sí |
| Redactar `/contact/compose` | 0 / 0 | 0 / 0 | 1 / 1 | sí | sí | sí |
| Secuencia `/contact/sequence` | 0 / 0 | 0 / 0 | 1 / 1 | sí | sí | sí |
| Oportunidades `/opportunities` | 0 / — | 3 / — | 9 / — | sí | sí | sí |
| Cowork `/cowork` | 6 / — | 0 / — | 16 / — | sí | sí | sí |
| Perfil `/profile` | 2 / 1 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Conexiones `/connections` | 0 / 0 | 0 / 0 | 8 / 4 | sí | sí | sí |
| Firmas y estilo `/settings/email-studio` | 2 / 1 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Organización `/settings/organization` | 0 / 0 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Privacidad `/settings/privacy` | 0 / 0 | 0 / 0 | 4 / 2 | sí | sí | sí |
| Solicitudes de privacidad `/settings/privacy-requests` | 2 / — | 0 / — | 16 / — | sí | sí | sí |
| Incidentes de privacidad `/settings/privacy-incidents` | 6 / — | 0 / — | 12 / — | sí | sí | sí |
| Bajas `/settings/unsubscribes` | 4 / 2 | 2 / 2 | 7 / 7 | sí | sí | sí |
| Créditos y uso `/dashboard` | 2 / 1 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Administración `/dashboard/admin` | 6 / — | 0 / — | 16 / — | sí | sí | sí |
| Usuarios `/dashboard/admin/users` | 9 / — | 0 / — | 16 / — | sí | sí | sí |
| Detalle de usuario `/dashboard/admin/users/:id` | 0 / — | 0 / — | 7 / — | sí | sí | sí |
| Equipos `/dashboard/admin/teams` | 4 / — | 0 / — | 12 / — | sí | sí | sí |
| Créditos del equipo `/dashboard/admin/credits` | 2 / — | 0 / — | 12 / — | sí | sí | sí |
| Centro de ayuda `/ayuda` | 0 / 0 | 0 / 0 | 16 / 16 | sí | sí | sí |
| Ayuda: primeros pasos `/ayuda/primeros-pasos` | 0 / 0 | 0 / 0 | 9 / 9 | sí | sí | sí |
| Conectar extensión `/extension/connect` | 0 / 0 | 0 / 0 | 0 / 0 | sí | sí | sí |

## Primera corrida: 21 hallazgos

Sobre `main` en 223f939, antes de #190 (Firmas y estilo) y de los arreglos de esta PR. Cada hallazgo se revisó a mano. Los que eran del motor, y no de la app, llevaron a ajustarlo en [insigne123/ANTON.IA-supabase#191](https://github.com/insigne123/ANTON.IA-supabase/pull/191).

| Página | Hallazgo | Gravedad | Qué era | Qué se hizo |
|---|---|---|---|---|
| Buscar prospectos (owner y member) | «Búsquedas guardadas» abría un menú sin opciones de menú (axe `aria-required-children`) | grave | Real | Ahora es una lista en un panel; cada búsqueda es un botón y cargar una cierra el panel |
| Buscar prospectos | Con las lecturas fallando: una promesa rechazada sin capturar y ningún aviso | crítico y grave | Real | Se registra el error y un aviso dice que las marcas «Guardado» y «Contactado» pueden faltar |
| Pipeline | Con las lecturas fallando decía «Aún no hay leads en el pipeline» | grave | Real: cada lectura caía a una lista vacía | «Pipeline no disponible» con «Reintentar»; si fallan solo algunas, «Faltan datos: no pudimos leer …». La actualización de cada minuto conserva lo último que se vio |
| Tabla de datos | No avisaba | grave | Real, la misma causa | Igual que el Pipeline; la tabla dice «Tus datos no se pudieron leer» en vez de «Tu hoja está vacía» |
| Bajas y bloqueos | «Correos (0)» y «No hay correos bloqueados» | grave | Real: el servicio devolvía una lista vacía | Aviso con «Reintentar»; las pestañas no muestran un cero y la tabla dice que no se pudo leer |
| Privacidad | Si no se puede comprobar el acceso, las filas de administración desaparecen sin aviso | grave | Real, de bajo impacto | Una línea dice que no se pudo comprobar |
| Firmas y estilo | Promesa rechazada sin capturar | crítico | Pantalla anterior a #190 | En la pantalla nueva no se repite |
| Campañas, Solicitudes e Incidentes de privacidad | «No avisa» o «vacío» | grave | Falso positivo: muestran el mensaje del servidor | El motor reconoce ese mensaje |
| Centro de ayuda, Primeros pasos, Importar contactos, Redactar, Secuencia, Conectar extensión | «No avisa» o «vacío» | grave | Falso positivo: no dependen de lecturas, o su «aún no…» también está con datos | El motor compara con la misma página con datos |
| Conexiones, Privacidad, Centro de ayuda | «No se ve que carga» | leve | Conexiones: falso positivo («Revisando tus cuentas…» con giro). Privacidad y Centro de ayuda: muestran todo al tiro y suman lo de administración al comprobar el acceso | El motor reconoce «Revisando…»; lo demás queda aceptado |

## Después de los arreglos

Sobre esta PR, con el motor ajustado:

- **Errores y carga lenta en las 33 páginas:** de 19 hallazgos a 3, y los 3 quedan aceptados (abajo).
- **Todas las revisiones** en las 9 páginas que tocan los arreglos, como owner y member (Buscar prospectos, Pipeline, Tabla de datos, Campañas, Conversaciones, Bajas y bloqueos, Privacidad, Por escribir y Firmas y estilo):
  - 1 hallazgo leve, el de Privacidad que aparece abajo;
  - 0 errores de página;
  - 0 problemas de axe en lo que se abre.

Queda aceptado:

| Página | Hallazgo | Por qué se acepta |
|---|---|---|
| Privacidad | Las filas de solicitudes e incidentes aparecen después de comprobar el acceso, sin indicador | La página se usa de inmediato. Lo que aparece después es solo para administradores, y si falla la comprobación ahora se dice |
| Centro de ayuda | Si no se puede comprobar el acceso, no aparecen las secciones de Oportunidades ni las de administración, y no se avisa (grave, según el motor). Con carga lenta aparecen después, sin indicador (leve) | Es la misma comprobación del menú, que tampoco muestra esos módulos si no se pudo comprobar. El resto de la ayuda se usa de inmediato y no depende de ninguna lectura |
