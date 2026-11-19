import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const distHtml = path.resolve(projectRoot, 'dist/index.html');
const distMain = path.resolve(projectRoot, 'dist-electron/main.js');
const distPreload = path.resolve(projectRoot, 'dist-electron/preload.cjs');

// Auto-build if production assets are absent
if (!fs.existsSync(distHtml) || !fs.existsSync(distMain) || !fs.existsSync(distPreload)) {
  console.log('[WaveForm Start] Production assets missing. Running npm run build...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
}

console.log('[WaveForm Start] Launching WaveForm Desktop Client (Production)...');
const electronProcess = spawn(electronPath, ['.'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
  },
});

electronProcess.on('close', (code) => {
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  process.exit(0);
});
