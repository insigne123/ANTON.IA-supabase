# Plan 16: Cowork hace lo que pediste, en palabras simples (8 oct 2026)

Esta ronda sigue el objetivo del Plan 15: que la IA sea útil y que Cowork sea una extensión del usuario. Se partió por lo que el juez
seguía marcando en el banco completo (134 casos) y por los 3 casos que fallaban siempre.

Todo se midió antes y después con el modelo real (`gpt-6-luna`; juez de Cowork `gpt-6.1-sol`), sin astra, sin escrituras en la base y
sin envíos. Ningún PR trae migraciones ni flags nuevos.

## Lo que cambió

| PR | Qué cambia | Medición |
|---|---|---|
| #259 Juez | El juez lee las tarjetas como el usuario: la búsqueda en palabras, el costo y la campaña como texto; sabe que un teléfono cuesta 10 créditos y que sin remitente elegido sale Gmail. Solo cambia la medición. | Las mismas respuestas: buenas 2 → 6 de 8; desaparecen 5 quejas falsas |
| #260 Búsqueda de prospectos | Un cargo por término: separa los cargos juntados con « / » o «;» y descarta el pedazo cortado («… / Gerente de S»). | Pasaba en 6 de 190 búsquedas guardadas (3 %); ahora no puede pasar |
| #261 Consultas | Una consulta ya hecha no vuelve como pregunta ni como botón «Sí, revisa…». Ante el saldo, Cowork dice cuántos contactos no tienen correo. | Botón viejo de vuelta 2 de 6 → 0 de 7; contactos sin correo 0 de 2 → 3 de 4; checks 19 → 24 de 26 |
| #262 Palabras simples | Reintentos sin «terminal» ni «conciliar»; dominio con cada registro explicado y los rebotes en la misma consulta; gráficos en Excel o CSV (la guía decía Word o PDF); cifras de la organización dichas como tales. | «conciliar» o «terminal» 7 → 0; Word o PDF para gráficos 4 → 0; claridad 4,00 → 4,83; veracidad 4,00 → 4,44 |
| #263 Encontrar clientes | «Ayúdame a encontrar clientes» propone buscar prospectos nuevos; «ayúdame a vender» sigue partiendo por los contactos con correo. Era la decisión pendiente del Plan 15. | Propone la búsqueda 0 → 2 de 2; los otros casos sin cambios (4 de 4) |
| #264 Seguimientos de LinkedIn | «Una persona por empresa»: Cowork elige, deja a la otra para otra semana y ofrece los mensajes con una prueba de la oferta. El juez sabe que los teléfonos se aprueban de a uno. | Elige sin preguntar 1 → 3 de 3; ofrece los mensajes con una prueba 0 → 3 de 3 |

El detalle de cada uno está en `docs/cowork-plan16-juez.md`, `docs/cowork-plan16-cargos.md`, `docs/cowork-plan16-consultas.md`,
`docs/cowork-plan16-palabras-simples.md`, `docs/cowork-plan16-encontrar-clientes.md` y `docs/cowork-plan16-uno-por-empresa.md`.

## Lo que se probó y no se integró

- Una regla para no ofrecer consultas en los botones, y forzar la consulta cuando solo la ofrecía el primer botón: no movieron la cifra
  (quejas 11 → 9 de 26; respuestas así 6 → 5 de 26). Quedaron fuera de #261.
- `claude/borradores-sin-hipotesis` (sin PR): los borradores sin señal abren con una situación inventada («Si hay un peak en Minera
  Cascada, con más de 2.000 trabajadores…»), y «suena humano» queda en 3,48. La regla nueva está lista, pero la medición se cortó
  porque la cuenta de OpenAI de las pruebas quedó sin créditos. Se integra solo si, medida, sube «suena humano» sin bajar la veracidad
  (`docs/borradores-plan16-sin-hipotesis.md`).

## Para el mantenedor

1. **Créditos de OpenAI.** La clave de las pruebas respondió `insufficient_quota` («You have no credits remaining») a las 09:12 UTC.
   Si es la misma de producción, Cowork, los borradores y el informe no responden hasta recargar.
2. **Desplegar `main`** con su tag `prod-AAAA-MM-DD`. No hay migraciones ni variables nuevas; los borradores siguen en
   `native-draft/v19` y los informes en `report-v2/editor/9`.
3. **Pruebas de humo** de siempre (`/api/onboarding/tour` 401, `/cowork` 200, `POST /api/cowork/wake` 401).
4. **Rollback**: `git revert` del PR que corresponda, redeploy y pruebas de humo. Ninguno deja datos que limpiar.

## Lo que queda

- **Medir con datos reales**: sin acceso de lectura a producción, todo se midió con el banco.
- **Botones secundarios** que ofrecen revisar contactos («Revisa mis contactos y dime cuáles…»): siguen siendo la queja más frecuente
  del juez. El juez varía mucho entre corridas, así que hace falta una muestra mayor para decidir.
- **Tableros del banco**: el banco arma los datos del tablero con las 4 filas leídas, no con el total de la cuenta como producción.
- **Revelar teléfonos y reintentar envíos** siguen apagados en producción por flag; sus casos se juzgan con esa regla.
