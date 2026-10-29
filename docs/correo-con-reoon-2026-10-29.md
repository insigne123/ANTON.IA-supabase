# Correo con Reoon cuando Apollo no lo tiene · 29 oct 2026

## Problema

En el ciclo de octubre, Apollo identificó a 146 personas pedidas desde la app pero no entregó su correo. Ni siquiera uno no verificado: las marcó "unavailable". Igual cobró 1 crédito por cada una.

## Qué hace la app

Cada 5 minutos, después de la reconciliación de Apollo (`/api/cron/apollo-reconciliation`), el buscador de correos (`src/lib/server/email-finder`) toma hasta 10 leads con esta condición:

- se le pidió el correo a Apollo en los últimos 60 días;
- Apollo terminó, ya sea sin datos o solo con teléfono;
- el lead sigue sin correo y no está bloqueado.

Para cada lead:

1. **Dominio:** usa el del lead. Si no tiene, el de su sitio web o el más usado por otros leads de la misma empresa. Descarta dominios de correo gratuito y los que no reciben correo (sin registro MX).
2. **Correos probables:** arma hasta 6 con nombre y apellidos, sin tildes ni iniciales. Primero va el formato que ya usa la empresa, deducido de los correos verificados de ese dominio que hay en la base (solo se usa el formato). Después van los formatos comunes: `nombre.apellido`, `napellido`, `nombreapellido`, `n.apellido`, `nombre`, etc.
3. **Bajas:** si alguno de esos correos está dado de baja, no se verifica nada.
4. **Verificación:** se consulta Reoon en modo "power", uno por uno, y se detiene en el primero que exista (`safe`). Ese correo se guarda en el lead como `verified`, solo si el lead sigue sin correo. El trigger de bajas de las tablas de leads sigue aplicando.
5. **Dominios que aceptan todo** (`catch_all`): Reoon no puede decir cuál es el correo real.
   - Se guarda una suposición como `extrapolated` solo si la empresa usa un formato claro: al menos 2 correos conocidos y 60 % o más con ese formato.
   - Si no, el lead queda sin correo.
   - El dominio se recuerda 30 días para no gastar más verificaciones en él.
6. **Reintentos:** si Reoon responde "unknown" para todo, el lead se reintenta en 6 horas, hasta 3 intentos. Si Reoon rechaza la cuenta (clave, créditos o límite de velocidad), la corrida se detiene y los leads vuelven a la cola en una hora.

`email_finder_attempts` guarda el estado de cada lead, el dominio, el formato usado y cuántas verificaciones gastó. No guarda correos.

## Cómo se enciende

1. Crear la cuenta en Reoon y su clave de API.
2. Crear el secreto `REOON_API_KEY` en App Hosting (`firebase apphosting:secrets:set REOON_API_KEY` y dar acceso al backend `studio`).
3. Agregar el secreto en `apphosting.yaml`, en el comentario junto a `EMAIL_FINDER_ENABLED`. Si se agrega antes de que exista el secreto, el despliegue falla.
4. Aplicar la migración `20261029150000_email_finder_attempts.sql` y desplegar.

Sin `REOON_API_KEY`, o con `EMAIL_FINDER_ENABLED` distinto de `"true"`, el buscador no hace nada.

Variables opcionales:

| Variable | Qué controla | Por defecto | Rango |
|---|---|---|---|
| `EMAIL_FINDER_LOOKBACK_DAYS` | Días hacia atrás | 60 | 1–120 |
| `EMAIL_FINDER_BATCH` | Leads por corrida | 10 | 1–25 |
| `EMAIL_FINDER_MAX_CANDIDATES` | Correos verificados por persona | 6 | 1–10 |

## Costo

Cada verificación gasta 1 crédito de Reoon. En el peor caso son 6 por persona; en la práctica, menos, porque se detiene en el primer correo válido y no repite dominios que aceptan todo. Los 146 de octubre caben en menos de 900 verificaciones. No se cobra un crédito adicional a la persona usuaria.

## Medir

```sql
select status, count(*), sum(verifications)
from email_finder_attempts
group by 1
order by 2 desc;
```
