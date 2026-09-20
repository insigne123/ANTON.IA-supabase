# Cowork code executor

Isolated Python/Node execution for ANTON.IA Cowork, running on the Oracle VM
(`axis-oci-company`). Node 22, **stdlib only, zero npm dependencies**.

## Protocol

- `GET /v1/health` → `{ ok, busy }` (bearer required).
- `POST /v1/jobs` with `Authorization: Bearer <secret>`, JSON body:
  `{ idempotencyKey, language: "python"|"node", code, files: [{name, contentBase64}], timeoutMs? }`
- Responses: `{ status: completed|failed|timeout, exitCode, stdout, stderr, files: [{name,size,contentBase64}], durationMs, reused }`.
- Same key + same content → replay without re-executing (`reused: true`).
- Same key + different content → `409` conflict, never executes.
- Busy (one job at a time) → `409 { error: Executor busy }`, retry later.

Limits: code ≤ 64 KB, ≤ 8 input files, ≤ 20 MB total, timeout ≤ 120 s,
outputs ≤ 10 MB / 16 files. Job containers: `--network none`, 2 GB RAM,
1 vCPU, 128 pids, read-only rootfs, `cap-drop ALL`, `no-new-privileges`,
uid 65534, killed on timeout, workdir wiped. No secrets or network inside jobs.

## Layout on the VM

- Code: `/opt/cowork-executor` (`server.mjs`, `lib/`, `test/`), user `cowork-exec`.
- Secret: `/etc/cowork-executor/secret` (root:cowork-exec, 0640). Bearer value.
- Data: `/var/lib/cowork-executor/{jobs,results}`.
- Images: `cowork-exec-py:1` (pandas/openpyxl/matplotlib), `cowork-exec-node:1`.
- Service: `cowork-executor.service` (systemd, localhost only).
- Public path: `https://ocr-test.yago.cl/cowork-exec/` via nginx (TLS +
  10 req/min rate limit). Files: `deploy/nginx-cowork-exec-{zone,location}.conf`.

## Operations

```bash
# Logs
sudo journalctl -u cowork-executor -n 50 --no-pager
# Restart after code update (copy files, chown cowork-exec, restart)
sudo systemctl restart cowork-executor
# Reap stale containers (normally none; service removes them itself)
sudo docker ps -a --filter name=cowork-job
# Rotate the bearer (also update Secret Manager COWORK_EXECUTOR_SECRET)
openssl rand -hex 32 | sudo tee /etc/cowork-executor/secret >/dev/null
sudo systemctl restart cowork-executor
```

Health without running a job (on the VM, secret stays server-side):

```bash
S=$(sudo cat /etc/cowork-executor/secret)
curl -ks -H "Authorization: Bearer $S" https://ocr-test.yago.cl/cowork-exec/v1/health
```

## Tests

Local (no Docker needed): `node --test executor/test/validate.test.mjs executor/test/runner.test.mjs executor/test/app.test.mjs`
from the repo root. Live validation scripts live outside the repo (Temp).

## Studio wiring (pending)

- `COWORK_EXECUTOR_URL=https://ocr-test.yago.cl/cowork-exec` (apphosting value).
- `COWORK_EXECUTOR_SECRET` (Secret Manager, create in console; never in repo).
