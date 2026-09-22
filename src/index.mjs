import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexRepository } from './repository.mjs';
import { CodexControlClient } from './control.mjs';
import { DeliveryInbox } from './deliveries.mjs';
import { createBridgeServer } from './server.mjs';
import { createUsageReader, requestRateLimits } from './usage.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const home = process.env.HOME;
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const codexBin = process.env.CODEX_BIN || '/Applications/ChatGPT.app/Contents/Resources/codex';
const control = new CodexControlClient({
  codexBin,
  socketPath: process.env.CODEX_APP_SERVER_SOCKET || '',
});

if (!home) throw new Error('HOME 环境变量不可用');

const secretPath = process.env.BRIDGE_TOKEN_FILE || join(home, 'Library', 'Application Support', 'Codex Task Bridge', 'session-secret');
const token = process.env.BRIDGE_TOKEN || await loadOrCreateSecret(secretPath);
const deliveryDirectory = process.env.CODEX_TASK_DESK_INBOX || (process.platform === 'darwin'
  ? join(home, 'Library', 'Application Support', 'Codex Task Bridge', 'deliveries')
  : join(home, '.local', 'share', 'codex-task-desk', 'deliveries'));
const deliveryStagingDirectory = process.env.CODEX_TASK_DESK_OUTBOX || (process.platform === 'darwin'
  ? '/private/tmp/codex-task-desk-outbox'
  : '/tmp/codex-task-desk-outbox');
const deliveryInbox = new DeliveryInbox({ directory: deliveryDirectory, stagingDirectory: deliveryStagingDirectory });

const repository = new CodexRepository({
  stateDb: process.env.CODEX_STATE_DB || join(home, '.codex', 'state_5.sqlite'),
  queueDb: process.env.CODEX_QUEUE_DB || join(home, '.codex', 'queue_1.sqlite'),
  historyDb: process.env.CODEX_HISTORY_DB || join(home, '.codex', 'thread_history_1.sqlite'),
  goalsDb: process.env.CODEX_GOALS_DB || join(home, '.codex', 'goals_1.sqlite'),
  codexBin,
  steerMessage: (threadId, turnId, message) => control.steer(threadId, turnId, message),
  startTurn: (threadId, message, cwd) => control.resume(threadId, message, cwd),
});
const usageReader = createUsageReader({ request: () => requestRateLimits({ codexBin }) });
const { server } = createBridgeServer({ repository, token, publicDir: join(root, 'public'), usageReader, deliveryInbox });

server.listen(port, host, () => {
  const addresses = lanAddresses().map((address) => `http://${address}:${port}/`);
  console.log('\nCodex Local Hub / Codex 掌上任务台已启动');
  console.log(`本机：http://127.0.0.1:${port}/`);
  for (const address of addresses) {
    console.log(`手机：${address}`);
    console.log(`配对：${address}pair/${encodeURIComponent(token)}`);
  }
  console.log('按 Ctrl+C 停止\n');
});

async function loadOrCreateSecret(path) {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (existing) return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const secret = randomBytes(32).toString('base64url');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${secret}\n`, { mode: 0o600 });
  return secret;
}

function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => item.address);
}
