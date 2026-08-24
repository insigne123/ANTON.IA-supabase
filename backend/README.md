# Apollo Backend

This service is an internal Apollo adapter. It exposes only `POST /api/lead-search`
and `POST /api/enrich`; both require the `x-api-secret-key` header.

`ENRICHMENT_SERVICE_SECRET` must be present at runtime in this service and in the
root Next.js BFF, with exactly the same value. It must never use a `NEXT_PUBLIC_`
name or be sent by browser code.

The service rejects missing or invalid secrets in every environment, bounds request
bodies and provider work, uses a process-local endpoint rate limit, and emits
structured `apollo-backend-audit` entries to Cloud Logging. Root BFF quota and event
ledger behavior remains the durable usage record.
