import { buildApp } from '@/app.js';
import { loadEnv } from '@/config/env.js';

const env = loadEnv();
const app = buildApp(env);

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, '收到进程退出信号，开始优雅关闭');
  try {
    await app.close();
  } catch (error) {
    app.log.error({ error }, '优雅关闭失败');
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
if (process.send) {
  process.on('message', (message) => {
    if (message === 'shutdown') void shutdown('SIGTERM');
  });
}

try {
  await app.listen({ host: '0.0.0.0', port: env.PORT });
} catch (error) {
  app.log.error(error);
  await shutdown('SIGTERM');
  process.exitCode = 1;
}
