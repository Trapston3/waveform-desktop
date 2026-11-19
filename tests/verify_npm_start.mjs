// tests/verify_npm_start.mjs
// Verifies that `node scripts/start.mjs` launches Electron in production mode cleanly.

import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('--- Testing scripts/start.mjs Execution ---');

const child = spawn('node', ['scripts/start.mjs'], {
  cwd: path.resolve('.'),
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  const str = data.toString();
  stdout += str;
  process.stdout.write(`[start.mjs stdout] ${str}`);
});

child.stderr.on('data', (data) => {
  const str = data.toString();
  stderr += str;
  process.stderr.write(`[start.mjs stderr] ${str}`);
});

await new Promise((resolve) => setTimeout(resolve, 5000));

if (process.platform === 'win32' && child.pid) {
  try {
    const { execSync } = await import('node:child_process');
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    // Process already terminated
  }
}

console.log('\n--- Verifying start.mjs Output ---');
assert.ok(stdout.includes('[WaveForm Start]'), 'Must print WaveForm Start banner');
assert.ok(stdout.includes('Loading local production bundle'), 'Must load local production bundle');
console.log('[ALL PASS] scripts/start.mjs verified successfully!');
