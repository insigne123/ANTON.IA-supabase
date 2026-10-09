# Tarjeta de búsqueda de Cowork sin líneas vacías (9 oct 2026)

## Problema

La tarjeta de aprobación de una búsqueda mostraba siempre cuatro líneas de «Clasificación por cargo», aunque la búsqueda no definiera
algunas: «Usuarios: Sin criterio», «Referidores: Sin criterio», «Excluir: Ninguno». Una lectura ciega lo marcó como jerga que no ayuda a
decidir.

## Cambio

`src/components/cowork/CoworkApproval.tsx`: la tarjeta muestra solo las líneas que la búsqueda define, y no muestra el bloque si no
define ninguna. «Referidores» pasa a «Pueden recomendarte» y «Excluir» a «Se excluyen».

Es un cambio de presentación; no cambia lo que se busca ni lo que se aprueba. Sin migraciones ni flags.
