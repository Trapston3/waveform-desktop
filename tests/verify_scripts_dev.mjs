// tests/verify_scripts_dev.mjs
// Verifies that `node scripts/dev.mjs` starts Vite, probes port 5173, and launches Electron connected to dev server.

import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('--- Testing scripts/dev.mjs Programmatic Startup ---');

const child = spawn('node', ['scripts/dev.mjs'], {
  cwd: path.resolve('.'),
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  const str = data.toString();
  stdout += str;
  process.stdout.write(`[dev.mjs stdout] ${str}`);
});

child.stderr.on('data', (data) => {
  const str = data.toString();
  stderr += str;
  process.stderr.write(`[dev.mjs stderr] ${str}`);
});

// Wait up to 12s for compile, vite listen, electron spawn, probe, loadURL
await new Promise((resolve) => setTimeout(resolve, 10000));

if (process.platform === 'win32' && child.pid) {
  try {
    const { execSync } = await import('node:child_process');
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    // Process already terminated
  }
}

console.log('\n--- Verifying dev.mjs Output ---');
assert.ok(stdout.includes('[WaveForm Dev] Compiling Electron main and preload scripts'), 'Must compile electron scripts');
assert.ok(stdout.includes('[WaveForm Dev] Vite dev server ready at:'), 'Must start Vite dev server');
assert.ok(stdout.includes('[WaveForm Dev] Launching Electron desktop window'), 'Must launch Electron desktop window');
assert.ok(stdout.includes('Dev server active at') || stdout.includes('Successfully loaded dev server'), 'Electron must connect to active dev server');
console.log('[ALL PASS] scripts/dev.mjs lifecycle verified successfully!');
