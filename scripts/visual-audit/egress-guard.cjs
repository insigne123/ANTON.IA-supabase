// Preloaded into the audited `next start` (NODE_OPTIONS=--require): a connection to any host that is not loopback fails at
// once and is written to stderr as `[audit-egress] blocked host:port`. http, https and fetch (undici) all connect through
// net.Socket, so this one patch covers them. The audit never reaches a real service, even if a code path tries.
const net = require('node:net');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);
const original = net.Socket.prototype.connect;

net.Socket.prototype.connect = function connect(...args) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  let host;
  let port;
  if (options && typeof options === 'object') { host = options.host ?? options.hostname; port = options.port; if (options.path) return original.apply(this, args); }
  else { port = first; host = typeof args[1] === 'string' ? args[1] : 'localhost'; }
  host = String(host ?? 'localhost').replace(/^\[|\]$/g, '');
  if (!LOOPBACK.has(host)) {
    process.stderr.write(`[audit-egress] blocked ${host}:${port}\n`);
    const error = Object.assign(new Error(`Auditoría visual: conexión bloqueada a ${host}:${port}`), { code: 'ECONNREFUSED' });
    process.nextTick(() => this.destroy(error));
    return this;
  }
  return original.apply(this, args);
};
