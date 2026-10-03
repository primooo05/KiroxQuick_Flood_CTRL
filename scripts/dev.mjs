import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const proxy = spawn(process.execPath, [resolve('server/windyProxy.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, CAMERA_PROXY_API_ONLY: '1' },
});
const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js')], {
  stdio: 'inherit',
  env: process.env,
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  proxy.kill('SIGTERM');
  vite.kill('SIGTERM');
  process.exitCode = code;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
proxy.on('exit', (code) => { if (!stopping && code !== 0) stop(code ?? 1); });
vite.on('exit', (code) => stop(code ?? 0));
