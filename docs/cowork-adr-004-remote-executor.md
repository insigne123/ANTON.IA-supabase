# ADR-004 — Ejecutor remoto de código para Cowork (Fase 3)

Fecha: 2026-09-20. Estado: implementado y validado en la VM; pendiente activar en studio (secreto + despliegue).
Decisión previa relacionada: usar la VM `axis-oci-company` ampliada a 24 GB (opción A).

## Contexto

Cowork debe ejecutar Python/Node generado por el agente (limpiar CSV, cruzar
listas, gráficos, documentos) sin acceso a credenciales de producción ni a los
datos de AXIS, que convive en la misma VM.

## Decisión

Servicio ejecutor dedicado en la VM, separado de AXIS:

- **Proceso propio** (`cowork-executor`, usuario `cowork-exec`, systemd), solo
  escucha en `127.0.0.1:8899`. Sin socket Docker dentro de los trabajos.
- **Entrada por nginx existente**: `https://ocr-test.yago.cl/cowork-exec/` con
  `Authorization: Bearer <secreto>`. Sin subdominio ni certificado nuevos.
  Límite de tasa en nginx además del secreto.
- **Un trabajo a la vez** (piloto): mutex en proceso; ocupado responde 409 para
  que el worker de studio reintente después.
- **Aislamiento por trabajo** (Docker, runtime runc):
  `--network none`, `--memory=2g --memory-swap=2g`, `--cpus=1.0`,
  `--pids-limit=128`, sistema de archivos de solo lectura salvo `/work` y
  `/out` temporales, `--cap-drop=ALL`, `--security-opt=no-new-privileges`,
  usuario no root, timeout 120 s con kill, directorio destruido al terminar.
- **Imágenes fijas** construidas una vez en la VM: `cowork-exec-py:1`
  (python:3.12-slim + pandas + openpyxl + matplotlib + python-docx +
  python-pptx) y `cowork-exec-node:1` (node:22-slim, solo stdlib en v1). Sin
  `docker pull` en tiempo de ejecución.
- **Entradas validadas**: `python|node`, código ≤ 64 KB, ≤ 8 archivos,
  total ≤ 20 MB, nombres saneados (sin rutas, sin traversal), extensiones
  permitidas `csv, json, md, txt, xlsx`. Sin archivos ZIP de entrada en v1
  (sin descompresión que limitar). Salidas: ≤ 10 MB totales, mismos tipos
  más `docx/pptx/zip/html/png/svg/pdf` generados. Studio además valida
  bytes mágicos y marcador `[Content_Types].xml` en la familia zip
  (xlsx/docx/pptx; zip plano solo magia) antes de promover artefactos.
- **Sin secretos en el entorno del trabajo** y sin acceso a PostgreSQL, al
  gateway local ni a la red. El código del agente se trata como no confiable.
- **Idempotencia**: `idempotencyKey` por trabajo de Cowork; reintentos con la
  misma clave devuelven el resultado guardado (ventana 24 h), nunca reejecutan.

## Alternativas descartadas

- **gVisor/Kata ahora**: `/dev/kvm` existe, pero añade piezas móviles sobre
  producción. Se evalúa si el piloto demuestra necesidad; runc + seccomp +
  AppArmor + límites es la base aceptada para v1 con un solo usuario.
- **E2B por consumo**: más barato con uso esporádico, pero suma proveedor,
  cuenta y datos fuera de nuestra infraestructura. Reevaluar si el uso supera
  ~50 h/mes de ejecución.
- **Ejecutar en studio (Cloud Run)**: mezcla código no confiable con el
  runtime de producción de ANTON.IA. Rechazado.

## Consecuencias

- Studio necesita `COWORK_EXECUTOR_URL` (valor) y `COWORK_EXECUTOR_SECRET`
  (Secret Manager, pendiente de crear: no se guarda en el repo).
- Límites iniciales: 1 trabajo, 2 GB, 1 vCPU, 120 s, 20 MB entrada.
- Costo infra adicional: US$0 (usa la ampliación ya aprobada a 24 GB).
- Riesgo aceptado: el grupo `docker` equivale a root; el servicio es código
  propio mínimo (solo stdlib) y los trabajos nunca tocan el socket.

## Validación realizada (puerta Fase 3, 2026-09-20)

- CSV → limpieza → `clean.csv`/`clean.json`; CSV → matplotlib → PNG + MD.
- CSV → python-docx/pptx → `informe.docx` + `presentacion.pptx` + `paquete.zip`,
  reabiertos con lector independiente (stdlib `zipfile` + XML): contenido correcto.
- HTML generado servido solo vía `?view=1` con CSP `sandbox allow-scripts` sin
  red y `X-Frame`/iframe `sandbox="allow-scripts"` de origen opaco; descarga
  por defecto sigue siendo `attachment`.
- Reintento con la misma clave sin reejecutar; conflicto ante distinto
  contenido; red/memoria/tiempo/1-trabajo aplicados; directorio eliminado.
- Fallo de ejecución reanuda el hilo con el error observado para proponer
  código corregido (nueva revisión humana, sin auto-ejecución).

## Operación y revocación

- Secreto bearer solo en `/etc/cowork-executor/secret` (`root:cowork-exec`,
  `0640`) y copia en Secret Manager `COWORK_EXECUTOR_SECRET`.
- Revocar: `sudo systemctl stop cowork-executor` (falla cerrado en studio) o
  rotar el secreto en ambos lados. Rate-limit nginx `10r/m` como segunda capa.
- Reconstruir imagen Python tras cambiar `executor/deploy/Dockerfile.py`:
  `docker build -t cowork-exec-py:1 .` en la VM; sincronizar
  `executor/lib/*.mjs` a `/opt/cowork-executor/lib/` y reiniciar el servicio.
