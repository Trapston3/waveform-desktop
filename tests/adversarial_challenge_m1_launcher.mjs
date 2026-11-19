// tests/adversarial_challenge_m1_launcher.mjs
// Adversarial empirical verification of Developer Experience, Launch Resilience, and Process Hygiene

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const projectRoot = path.resolve('.');

const runTest = async (name, testFn) => {
  console.log(`\n================================================================`);
  console.log(`RUNNING ADVERSARIAL TEST: ${name}`);
  console.log(`================================================================`);
  const start = Date.now();
  try {
    await testFn();
    const duration = Date.now() - start;
    console.log(`>>> [PASS] ${name} (${duration}ms)`);
    return { name, pass: true, duration, error: null };
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`>>> [FAIL] ${name} (${duration}ms):`, err.message);
    return { name, pass: false, duration, error: err };
  }
};

const killProcessTree = async (child) => {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      const { execSync } = await import('node:child_process');
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // already exited
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      // already exited
    }
  }
};

const closeHttpServer = async (server) => {
  if (!server) return;
  try {
    server.unref();
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
  } catch {}
  return new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 300);
  });
};

const spawnElectron = (env = {}, customUserDataDir = null) => {
  const userDataDir = customUserDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'wf-electron-test-'));
  const child = spawn(electronPath, ['.', `--user-data-dir=${userDataDir}`], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (d) => {
    const str = d.toString();
    stdout += str;
    process.stdout.write(`[Electron stdout] ${str}`);
  });

  child.stderr.on('data', (d) => {
    const str = d.toString();
    stderr += str;
    process.stderr.write(`[Electron stderr] ${str}`);
  });

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
};

const results = [];

// =============================================================================
// TEST 1: Slow Vite Startup (Simulated delayed bind at 1.0s)
// Electron probe 1 fails, probe 2 or 3 succeeds -> Connects to dev server cleanly
// =============================================================================
results.push(await runTest('Test 1: Slow Vite Startup (delayed bind at 1.0s)', async () => {
  const mockPort = 5173;
  let server = null;
  let hitCount = 0;

  // Start HTTP server after 1000ms delay
  const timer = setTimeout(() => {
    server = http.createServer((req, res) => {
      hitCount++;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body>Mock Slow Vite</body></html>');
    });
    server.listen(mockPort, '127.0.0.1');
    console.log(`[Mock Slow Vite] Server bound and listening on port ${mockPort}`);
  }, 1000);

  const { child, getStdout, getStderr } = spawnElectron({
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: `http://localhost:${mockPort}`,
  });

  try {
    // Wait 5 seconds for Electron to retry and connect
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const stdout = getStdout();
    const stderr = getStderr();

    assert.ok(stdout.includes('Probing dev server (attempt 1/3)'), 'Must log probe attempt 1');
    assert.ok(stdout.includes('Dev server not active yet. Retrying in 600ms'), 'Must log retry after attempt 1');
    assert.ok(stdout.includes('Dev server active at') || stdout.includes('Successfully loaded dev server'), 'Must successfully connect once active');
    assert.ok(!stdout.includes('Dev server unreachable after 3 probe attempts'), 'Must NOT report unreachable');
  } finally {
    clearTimeout(timer);
    await killProcessTree(child);
    await closeHttpServer(server);
  }
}));

// =============================================================================
// TEST 2: Hanging Dev Server (Server accepts TCP connection but hangs on response)
// Probe timeout (1000ms AbortController) should abort, retry, and fallback
// =============================================================================
results.push(await runTest('Test 2: Hanging Dev Server (TCP connected, HTTP stalls)', async () => {
  const mockPort = 5173;
  const server = http.createServer((req, res) => {
    // Deliberately do not send response to simulate stalled socket
    console.log('[Mock Hanging Server] Received request, deliberately hanging...');
  });
  await new Promise((resolve) => server.listen(mockPort, '127.0.0.1', resolve));

  const { child, getStdout, getStderr } = spawnElectron({
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: `http://localhost:${mockPort}`,
  });

  try {
    // Wait 7.5 seconds for 3 x ~1s timeouts + 2 x 600ms delays + fallback
    await new Promise((resolve) => setTimeout(resolve, 7500));
    const stdout = getStdout();
    const stderr = getStderr();

    assert.ok(stdout.includes('Probing dev server (attempt 1/3)'), 'Must attempt probe 1');
    assert.ok(stdout.includes('Probing dev server (attempt 2/3)'), 'Must attempt probe 2');
    assert.ok(stdout.includes('Probing dev server (attempt 3/3)'), 'Must attempt probe 3');
    assert.ok(stdout.includes('Dev server unreachable after 3 probe attempts') || stderr.includes('Dev server unreachable after 3 probe attempts'), 'Must report unreachable after 3 probes');
    assert.ok(stdout.includes('Loading local production bundle'), 'Must fall back to local dist/index.html');
  } finally {
    await killProcessTree(child);
    await closeHttpServer(server);
  }
}));

// =============================================================================
// TEST 3: HTTP 500 Dev Server
// Server returns 500 Internal Server Error -> probeServer returns false -> fallback
// =============================================================================
results.push(await runTest('Test 3: HTTP 500 Dev Server (probeServer < 500 check)', async () => {
  const mockPort = 5173;
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error in Vite plugin');
  });
  await new Promise((resolve) => server.listen(mockPort, '127.0.0.1', resolve));

  const { child, getStdout, getStderr } = spawnElectron({
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: `http://localhost:${mockPort}`,
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const stdout = getStdout();
    const stderr = getStderr();

    assert.ok(stdout.includes('Dev server unreachable after 3 probe attempts') || stderr.includes('Dev server unreachable after 3 probe attempts'), 'Must treat 500 as unreachable');
    assert.ok(stdout.includes('Loading local production bundle'), 'Must fallback to dist/index.html');
  } finally {
    await killProcessTree(child);
    await closeHttpServer(server);
  }
}));

// =============================================================================
// TEST 4: Dead Dev Server (Connection Refused)
// Probes 3 times with backoff, cleanly falls back to dist/index.html without crash
// =============================================================================
results.push(await runTest('Test 4: Dead Dev Server (Connection Refused)', async () => {
  const { child, getStdout, getStderr } = spawnElectron({
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: 'http://localhost:59998', // Unused port
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const stdout = getStdout();
    const stderr = getStderr();

    assert.ok(stdout.includes('Probing dev server (attempt 1/3)'), 'Probe 1 attempted');
    assert.ok(stdout.includes('Probing dev server (attempt 2/3)'), 'Probe 2 attempted');
    assert.ok(stdout.includes('Probing dev server (attempt 3/3)'), 'Probe 3 attempted');
    assert.ok(stdout.includes('Dev server unreachable after 3 probe attempts') || stderr.includes('Dev server unreachable after 3 probe attempts'), 'Must log unreachable');
    assert.ok(stdout.includes('Loading local production bundle'), 'Must load dist/index.html');
    assert.ok(!stderr.includes('UnhandledPromiseRejection'), 'No unhandled rejection');
  } finally {
    await killProcessTree(child);
  }
}));

// =============================================================================
// TEST 5: Custom VITE_DEV_SERVER_URL (Custom port 59876)
// Electron correctly respects and connects to custom VITE_DEV_SERVER_URL
// =============================================================================
results.push(await runTest('Test 5: Custom VITE_DEV_SERVER_URL', async () => {
  const customPort = 59876;
  let receivedHit = false;
  const server = http.createServer((req, res) => {
    receivedHit = true;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><body>Custom Port Server</body></html>');
  });
  await new Promise((resolve) => server.listen(customPort, '127.0.0.1', resolve));

  const { child, getStdout } = spawnElectron({
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: `http://localhost:${customPort}`,
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const stdout = getStdout();

    assert.ok(stdout.includes(`Probing dev server (attempt 1/3): http://localhost:${customPort}`), 'Must target custom port');
    assert.ok(stdout.includes(`Dev server active at http://localhost:${customPort}`), 'Must report active at custom port');
    assert.ok(stdout.includes(`Successfully loaded dev server: http://localhost:${customPort}`), 'Must load custom URL');
    assert.ok(receivedHit, 'Custom server must have received request');
  } finally {
    await killProcessTree(child);
    await closeHttpServer(server);
  }
}));

// =============================================================================
// TEST 6: Malformed VITE_DEV_SERVER_URL ("invalid-url-specifier")
// probeServer must catch TypeError and gracefully fallback to dist/index.html
// =============================================================================
results.push(await runTest('Test 6: Malformed VITE_DEV_SERVER_URL', async () => {
  const { child, getStdout, getStderr } = spawnElectron({
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: 'this-is-not-a-valid-url-at-all',
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const stdout = getStdout();
    const stderr = getStderr();

    assert.ok(stdout.includes('Probing dev server (attempt 1/3)'), 'Probe attempted with malformed URL');
    assert.ok(stdout.includes('Dev server unreachable after 3 probe attempts') || stderr.includes('Dev server unreachable after 3 probe attempts'), 'Safely logs unreachable');
    assert.ok(stdout.includes('Loading local production bundle'), 'Clean fallback to dist/index.html');
    assert.ok(!stderr.includes('TypeError: Invalid URL') && !stderr.includes('UnhandledPromiseRejection'), 'No uncaught crash on malformed URL');
  } finally {
    await killProcessTree(child);
  }
}));

// =============================================================================
// TEST 7: NODE_ENV=production Mode
// Must completely skip probing and load dist/index.html directly
// =============================================================================
results.push(await runTest('Test 7: NODE_ENV=production Bypass of Probes', async () => {
  const { child, getStdout, getStderr } = spawnElectron({
    NODE_ENV: 'production',
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const stdout = getStdout();
    const stderr = getStderr();

    assert.ok(!stdout.includes('Probing dev server'), 'Must NOT probe dev server in production');
    assert.ok(stdout.includes('Loading local production bundle'), 'Must immediately load local production bundle');
    assert.ok(!stderr.includes('UnhandledPromiseRejection'), 'No unhandled rejection in production');
  } finally {
    await killProcessTree(child);
  }
}));

// =============================================================================
// TEST 8: Recovery Card when neither Dev Server nor dist/index.html exists
// Rename dist/index.html temporarily, ensure recovery card renders
// =============================================================================
results.push(await runTest('Test 8: Recovery Card when both Dev Server and dist are absent', async () => {
  const distHtmlPath = path.resolve(projectRoot, 'dist/index.html');
  const tempPath = path.resolve(projectRoot, 'dist/index.html.bak_stress');

  if (fs.existsSync(distHtmlPath)) {
    fs.renameSync(distHtmlPath, tempPath);
  }

  try {
    const { child, getStdout, getStderr } = spawnElectron({
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: 'http://localhost:59997', // dead port
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 8000));
      const stdout = getStdout();
      const stderr = getStderr();

      assert.ok(stdout.includes('Dev server unreachable after 3 probe attempts') || stderr.includes('Dev server unreachable after 3 probe attempts'), 'Logs unreachable');
      assert.ok(!stdout.includes('Loading local production bundle'), 'Did not load absent production bundle');
      assert.ok(!stderr.includes('UnhandledPromiseRejection'), 'No unhandled rejection');
      assert.ok(!stderr.includes('ENOENT'), 'No unhandled ENOENT error');
    } finally {
      await killProcessTree(child);
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.renameSync(tempPath, distHtmlPath);
    }
  }
}));

// =============================================================================
// TEST 9: Single Instance Lock
// Spawning a second instance while the first runs must exit second instance
// =============================================================================
results.push(await runTest('Test 9: Single Instance Lock Enforcement', async () => {
  const sharedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-electron-single-lock-'));
  const instance1 = spawnElectron({ NODE_ENV: 'production' }, sharedUserData);
  await new Promise((resolve) => setTimeout(resolve, 3000));

  let instance2Exited = false;
  let instance2ExitCode = null;

  const instance2Child = spawn(electronPath, ['.', `--user-data-dir=${sharedUserData}`], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  instance2Child.on('exit', (code) => {
    instance2Exited = true;
    instance2ExitCode = code;
  });

  try {
    // Wait for instance 2 to recognize lock and quit
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.ok(instance2Exited, 'Second instance must exit immediately due to requestSingleInstanceLock');
    assert.equal(instance2ExitCode, 0, 'Second instance must exit with code 0');
  } finally {
    await killProcessTree(instance1.child);
    await killProcessTree(instance2Child);
  }
}));

// =============================================================================
// TEST 10: Clean Lifecycle & Process Hygiene in scripts/dev.mjs
// Verifies dev.mjs starts, and killing Electron terminates Vite and parent cleanly
// =============================================================================
results.push(await runTest('Test 10: scripts/dev.mjs Lifecycle & Process Hygiene', async () => {
  const child = spawn('node', ['scripts/dev.mjs'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });

  try {
    // Wait for Vite to bind and Electron to spawn
    await new Promise((resolve) => setTimeout(resolve, 10000));

    assert.ok(stdout.includes('Vite dev server ready at: http://localhost:5173/'), 'Vite started');
    assert.ok(stdout.includes('Launching Electron desktop window...'), 'Electron spawned');
    assert.ok(stdout.includes('Successfully loaded dev server: http://localhost:5173/'), 'Electron connected');

    // Cleanly terminate child process tree
    await killProcessTree(child);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify port 5173 is released and not hanging
    const isPortOpen = await new Promise((resolve) => {
      const probe = http.get('http://localhost:5173', (res) => {
        resolve(true);
      });
      probe.on('error', () => resolve(false));
      setTimeout(() => {
        probe.destroy();
        resolve(false);
      }, 1000);
    });

    assert.equal(isPortOpen, false, 'Port 5173 must be closed after clean shutdown');
  } finally {
    await killProcessTree(child);
  }
}));

// =============================================================================
// FINAL SUMMARY
// =============================================================================
console.log('\n\n================================================================');
console.log('         ADVERSARIAL STRESS TEST SUITE EXECUTION SUMMARY        ');
console.log('================================================================');
const passedCount = results.filter((r) => r.pass).length;
const failedCount = results.filter((r) => !r.pass).length;

for (const r of results) {
  const mark = r.pass ? '[PASS]' : '[FAIL]';
  console.log(`${mark.padEnd(8)} ${r.name} (${r.duration}ms)`);
}

console.log('----------------------------------------------------------------');
console.log(`TOTAL: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
console.log('================================================================');

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
