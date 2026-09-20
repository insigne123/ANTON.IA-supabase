import { createApp } from './lib/app.mjs';
import { createResultStore } from './lib/store.mjs';

/** Cowork code executor entrypoint. */
const config = {
  bind: process.env.EXECUTOR_BIND || '127.0.0.1',
  port: Number(process.env.EXECUTOR_PORT || 8899),
  secretFile: process.env.EXECUTOR_SECRET_FILE || '/etc/cowork-executor/secret',
  dataDir: process.env.EXECUTOR_DATA_DIR || '/var/lib/cowork-executor',
  baseDir: process.env.EXECUTOR_JOB_DIR || '/var/lib/cowork-executor/jobs',
};
const log = record => console.log(JSON.stringify({ service: 'cowork-executor', at: new Date().toISOString(), ...record }));

const store = createResultStore({ dir: `${config.dataDir}/results` });
await store.init();
const server = createApp({ store, config });
server.listen(config.port, config.bind, () => log({ event: 'listen', bind: config.bind, port: config.port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
