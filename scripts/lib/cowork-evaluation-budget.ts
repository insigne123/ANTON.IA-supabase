import { createHash, randomUUID } from 'node:crypto';
import { existsSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { StructuredTelemetry } from '../../src/ai/openai-json';

/** Standard Luna prices, verified against the model documentation on 2026-10-09.
 * Reservations use uncached input and a premium buffer; missing usage stays reserved. */
export const LUNA_PRICE = { model: 'gpt-6-luna', verifiedAt: '2026-10-09', input: 0.1, output: 0.5, cached: 0.01, premium: 2.2 } as const;
type Call = { id: string; reservedUsd: number; state: 'reserved' | 'known' | 'unknown'; costUsd?: number; model: string; at: string; inputHash: string; telemetry?: StructuredTelemetry };
type Ledger = { version: 1; ceilingUsd: number; price: typeof LUNA_PRICE; calls: Call[] };
export const evidenceHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class CoworkEvaluationBudget {
  constructor(private readonly file: string, private readonly ceilingUsd: number) {
    if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0 || ceilingUsd > 10) throw new Error('Evaluation budget must be >0 and <=10 USD');
    this.transaction(() => undefined);
  }
  private transaction<T>(change: (ledger: Ledger) => T): T {
    // Shared between sequential processes. Fail closed on an occupied/stale lock rather than risking double admission.
    const lock = `${this.file}.lock`;
    const fd = openSync(lock, 'wx');
    try {
      const ledger: Ledger = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8'))
        : { version: 1, ceilingUsd: this.ceilingUsd, price: LUNA_PRICE, calls: [] };
      if (ledger.version !== 1 || ledger.ceilingUsd !== this.ceilingUsd || evidenceHash(ledger.price) !== evidenceHash(LUNA_PRICE)) throw new Error('Evaluation ledger configuration mismatch');
      const result = change(ledger);
      const temp = `${this.file}.${randomUUID()}.tmp`;
      writeFileSync(temp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, this.file);
      return result;
    } finally { closeSync(fd); unlinkSync(lock); }
  }
  reserve(input: { model?: string; systemPrompt?: string; prompt: string; maxOutputTokens?: number; schema?: unknown }) {
    if (input.model !== LUNA_PRICE.model) throw new Error('Evaluation only permits gpt-6-luna');
    if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens! < 1) throw new Error('Explicit bounded output required');
    // One token per UTF-8 byte is intentionally conservative; include schema and protocol overhead.
    const inputTokens = Buffer.byteLength(JSON.stringify(input), 'utf8') + 8192;
    const reservedUsd = (inputTokens * LUNA_PRICE.input + input.maxOutputTokens! * LUNA_PRICE.output) / 1e6 * LUNA_PRICE.premium;
    return this.transaction(ledger => {
      const exposure = ledger.calls.reduce((sum, call) => sum + (call.state === 'known' ? call.costUsd! : call.reservedUsd), 0);
      if (exposure + reservedUsd > ledger.ceilingUsd) throw new Error('Evaluation dollar budget exhausted');
      const id = randomUUID();
      ledger.calls.push({ id, reservedUsd, state: 'reserved', model: input.model!, at: new Date().toISOString(), inputHash: evidenceHash(input) });
      return id;
    });
  }
  settle(id: string, telemetry?: StructuredTelemetry) {
    this.transaction(ledger => {
      const call = ledger.calls.find(item => item.id === id);
      if (!call || call.state === 'known') throw new Error('Evaluation reservation missing or already settled');
      const usage = telemetry?.usage;
      const input = usage?.prompt_tokens ?? usage?.input_tokens;
      const output = usage?.completion_tokens ?? usage?.output_tokens;
      const valid = typeof input === 'number' && typeof output === 'number' && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0;
      if (!valid || telemetry?.modelName !== LUNA_PRICE.model) { call.state = 'unknown'; return; }
      // Charge all input at uncached price and include possible regional/fast premium. Reasoning is already part of output.
      call.costUsd = (input * LUNA_PRICE.input + output * LUNA_PRICE.output) / 1e6 * LUNA_PRICE.premium;
      call.state = 'known'; call.telemetry = telemetry;
      if (call.costUsd > call.reservedUsd) throw new Error('Evaluation usage exceeded conservative reservation; stop');
    });
  }
  summary() {
    return this.transaction(ledger => ({ ceilingUsd: ledger.ceilingUsd, calls: ledger.calls.length,
      knownUsd: ledger.calls.reduce((sum, call) => sum + (call.state === 'known' ? call.costUsd! : 0), 0),
      pendingUsd: ledger.calls.reduce((sum, call) => sum + (call.state !== 'known' ? call.reservedUsd : 0), 0),
      incompleteCalls: ledger.calls.filter(call => call.state !== 'known').length, price: ledger.price }));
  }
}
