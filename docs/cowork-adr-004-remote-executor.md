# ADR-004 — Ejecutor remoto de código para Cowork (Fase 3)

Fecha: 2026-09-20. Estado: propuesto, en implementación.
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
  (python:3.12-slim + pandas + openpyxl + matplotlib) y
  `cowork-exec-node:1` (node:22-slim, solo stdlib en v1). Sin `docker pull`
  en tiempo de ejecución.
- **Entradas validadas**: `python|node`, código ≤ 64 KB, ≤ 8 archivos,
  total ≤ 20 MB, nombres saneados (sin rutas, sin traversal), extensiones
  permitidas `csv, json, md, txt, xlsx`. Sin archivos ZIP en v1 (sin
  descompresión que limitar). Salidas: ≤ 10 MB totales, mismos tipos más
  `png/svg/pdf` generados.
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

## Validación requerida (puerta Fase 3)

Trabajo Python que lea un CSV, lo limpie y devuelva XLSX + PNG; reintento con
la misma clave sin reejecutar; pruebas de fuga (red, lectura fuera de `/work`,
variables de entorno, binarios setuid) todas bloqueadas; límites de memoria y
tiempo aplicados; directorio del trabajo eliminado.
