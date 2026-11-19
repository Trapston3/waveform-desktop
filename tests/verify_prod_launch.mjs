// tests/verify_prod_launch.mjs
// Empirical test of Electron production boot: NODE_ENV=production npx electron .

import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

console.log('--- Testing Electron Production Launch ---');
console.log(`Electron Binary: ${electronPath}`);
console.log('Environment: NODE_ENV=production');

const env = {
  ...process.env,
  NODE_ENV: 'production',
};

const child = spawn(electronPath, ['.'], {
  cwd: path.resolve('.'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
let exitedEarly = false;
let exitCode = null;

child.stdout.on('data', (data) => {
  const str = data.toString();
  stdout += str;
  process.stdout.write(`[Electron stdout] ${str}`);
});

child.stderr.on('data', (data) => {
  const str = data.toString();
  stderr += str;
  process.stderr.write(`[Electron stderr] ${str}`);
});

child.on('exit', (code, signal) => {
  exitedEarly = true;
  exitCode = code;
  console.log(`[Electron Process Exit] code=${code}, signal=${signal}`);
});

// Give Electron 5 seconds to boot, initialize main window, load dist/index.html, and create tray
await new Promise((resolve) => setTimeout(resolve, 5000));

if (exitedEarly) {
  console.error(`FAIL: Electron exited prematurely with code ${exitCode}`);
  console.error(`Stderr: ${stderr}`);
  process.exit(1);
}

console.log('[PASS] Electron process successfully booted and remained running.');

// Check stderr for fatal errors
const fatalErrors = [
  'SyntaxError',
  'Cannot use import statement',
  'Uncaught Exception',
  'UnhandledPromiseRejection',
  'ERR_FAILED',
  'Cannot find module',
];

for (const fatal of fatalErrors) {
  assert.ok(
    !stderr.includes(fatal),
    `Fatal error found in stderr: ${fatal}`
  );
  console.log(`[PASS] No "${fatal}" detected in stderr`);
}

// Cleanly kill the child process
console.log('Terminating Electron production instance...');
child.kill('SIGTERM');

if (process.platform === 'win32' && child.pid) {
  try {
    const { execSync } = await import('node:child_process');
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    // Process already terminated
  }
}

console.log('\n[ALL PASS] Electron production launch verified cleanly without crashing!');
