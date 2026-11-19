// tests/verify_dev_fallback.mjs
// Verifies that when Electron is launched unpackaged (isDev = true) without Vite running,
// it logs the probe attempts and falls back to dist/index.html instead of crashing.

import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

console.log('--- Testing Electron Dev Fallback when Vite is Down ---');

const child = spawn(electronPath, ['.'], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: 'http://localhost:5173',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

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

// Give Electron ~6 seconds to do 3 retries (600ms backoff) and fallback
await new Promise((resolve) => setTimeout(resolve, 6000));

// Terminate child
if (process.platform === 'win32' && child.pid) {
  try {
    const { execSync } = await import('node:child_process');
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    // Process already terminated
  }
}

console.log('\n--- Verifying Fallback Output ---');
assert.ok(stdout.includes('Probing dev server') || stdout.includes('Connecting to dev server'), 'Must attempt connection to dev server');
assert.ok(stdout.includes('Dev server unreachable') || stderr.includes('Dev server unreachable') || stdout.includes('Falling back'), 'Must detect dev server unreachable');
assert.ok(stdout.includes('Loading local production bundle') || stdout.includes('Falling back to pre-built dist/index.html'), 'Must fall back to dist/index.html');
console.log('[ALL PASS] Resilient dev fallback confirmed operational!');
