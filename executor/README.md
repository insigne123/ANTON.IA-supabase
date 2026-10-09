# Cowork code executor

Isolated Python/Node execution for ANTON.IA Cowork, running on the Oracle VM
(`axis-oci-company`). Node 22, **stdlib only, zero npm dependencies**.

## Protocol

### Durable jobs (v2, 9 October 2026)

- `GET /v2/capabilities`: protocol, asynchronous/durable/cancellation support and bounded toolchain resources. Authenticated; no secrets in its response.
- `POST /v2/jobs`: same input as v1, returns `202` with a stable job identity, request hash, generation and status. Admission is saved before code starts.
- `GET /v2/jobs/<id>`: inspect that exact job and its result; never re-executes it.
- `POST /v2/jobs/<id>/cancel`: records `cancel_requested`; the runner confirms stop before publishing `cancelled`.
- Same id and bytes reuse the retained job. Different bytes conflict. One active job, shared with the v1 lane.
- A restart stops the recorded container and retains `interrupted` or `outcome_unknown`; it never replays code automatically. Results and manifests are persisted separately from container lifetime.
- The result store retains entries for 24 hours and caps 200 entries / 500 MB. Expiry is not a guarantee of permanent workspace retention: the app promotes completed assets to private Storage.

### Legacy synchronous jobs (v1)

- `GET /v1/health` → `{ ok, busy }` (bearer required).
- `POST /v1/jobs` with `Authorization: Bearer <secret>`, JSON body:
  `{ idempotencyKey, language: "python"|"node", code, files: [{name, contentBase64}], timeoutMs? }`
- Responses: `{ status: completed|failed|timeout, exitCode, stdout, stderr, files: [{name,size,contentBase64}], durationMs, reused }`.
- Same key + same content → replay without re-executing (`reused: true`).
- Same key + different content → `409` conflict, never executes.
- Busy (one job at a time) → `409 { error: Executor busy }`, retry later.

Limits: code ≤ 64 KB, ≤ 8 input files, ≤ 20 MB total, timeout ≤ 120 s,
outputs ≤ 10 MB / 16 files (`csv, json, md, txt, xlsx, docx, pptx, zip, html, css, js, mjs,
png, svg, pdf`). Job containers: `--network none`, 2 GB RAM,
1 vCPU, 128 pids, read-only rootfs, `cap-drop ALL`, `no-new-privileges`,
uid 65534, killed on timeout, workdir wiped. No secrets or network inside jobs.

`/work` is read-only and `/out` is a **10 MB tmpfs with an inode cap**, rather than an unbounded host bind. A trusted Python/Node launcher collects outputs before the tmpfs disappears on container stop. The launcher caps logs and enforces an independent 120-second watchdog, including if the supervisor disappears. Failed, cancelled or timed-out code publishes no outputs. Output SHA-256 hashes are included in the durable manifest; cleanup runs in `finally`, including on collection/validation failure. Runtime entrypoint names cannot be supplied as input files.

## Layout on the VM

- Code: `/opt/cowork-executor` (`server.mjs`, `lib/`, `test/`), user `cowork-exec`.
- Secret: `/etc/cowork-executor/secret` (root:cowork-exec, 0640). Bearer value.
- Data: `/var/lib/cowork-executor/{jobs,results}`.
- Images: `cowork-exec-py:1` (pandas/openpyxl/matplotlib/python-docx/python-pptx), `cowork-exec-node:1`.
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

Local (no Docker needed): `node --test executor/test/*.test.mjs`
from the repo root. Live validation scripts live outside the repo (Temp).

The unit tests exercise admission, conflict, replay, cancellation, late output, restart reconciliation and cleanup with controlled adapters. Real Docker/toolchain conformance remains required before activating v2 in Studio.

## Studio wiring

- `COWORK_EXECUTOR_URL=https://ocr-test.yago.cl/cowork-exec` (apphosting value).
- `COWORK_EXECUTOR_SECRET` (Secret Manager, create in console; never in repo).
- Runtime bindings were observed in Studio on 9 October 2026. That does not prove the current VM is running this v2 code.
- Activate `COWORK_EXECUTOR_ASYNC_ENABLED=true` only after the supervisor is updated and capabilities/conformance pass. The maintained application uses a short admission request and polls the same identity on subsequent queue wakes.
- `COWORK_BUILD_WORKSPACES_ENABLED=true` enables reuse of the owner's published assets as versioned inputs. Code and each input byte snapshot still require a new reviewed proposal; outputs cannot authorize effects or expand resources.
- Deploy and infrastructure activation belong to the maintainer. No VM, cloud plan or public preview is provisioned by these code changes.
