// Always starts a disposable localhost server. No connection URL or env file
// is accepted: even a shell containing production credentials cannot redirect it.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

export async function createIsolatedPostgres() {
  const { default: EmbeddedPostgres } = await import(process.env.COWORK_NATIVE_PG_MODULE
    ? pathToFileURL(process.env.COWORK_NATIVE_PG_MODULE).href : 'embedded-postgres');
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
  const directory = await mkdtemp(join(tmpdir(), 'cowork-pg-'));
  const server = new EmbeddedPostgres({ databaseDir: join(directory, 'data'),
    user: 'cowork_test', password: randomUUID(), port, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'], onLog() {}, onError() {} });
  const clients = [];
  const connect = async () => {
    const client = server.getPgClient();
    await client.connect();
    clients.push(client);
    await client.query("set statement_timeout='15s'");
    return client;
  };
  try {
    await server.initialise();
    await server.start();
    const client = await connect();
    return { query: (...args) => client.query(...args), exec: sql => client.query(sql), connect,
      async close() {
        await Promise.allSettled(clients.map(client => client.end()));
        await server.stop();
        await rm(directory, { recursive: true, force: true });
      } };
  } catch (error) {
    await Promise.allSettled(clients.map(client => client.end()));
    await server.stop().catch(() => {});
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
