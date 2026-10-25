import { spawn } from 'node:child_process';
const p = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'bridge'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
p.stdout.on('data', (d) => (out += d));
p.stderr.on('data', (d) => (out += d));
setTimeout(() => {
  p.kill('SIGINT');
  console.log(out);
  console.log('--- bridge boot OK (no crash) ---');
}, 4000);
