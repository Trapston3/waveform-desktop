// tests/adversarial_m1_suite.mjs
// Adversarial empirical test harness for Milestone M1

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const projectRoot = path.resolve('.');
const distHtmlPath = path.resolve(projectRoot, 'dist/index.html');
const distHtmlBakPath = path.resolve(projectRoot, 'dist/index.html.challenger_bak');

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // already exited
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already exited
    }
  }
}

async function probeHttp(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, data }));
    });
    req.on('error', (err) => resolve({ ok: false, error: err }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: new Error('timeout') });
    });
  });
}

async function fetchCdpPageUrl(port, retries = 30, delayMs = 400) {
  const url = `http://127.0.0.1:${port}/json`;
  for (let i = 0; i < retries; i++) {
    const res = await probeHttp(url, 1000);
    if (res.ok && res.data) {
      try {
        const targets = JSON.parse(res.data);
        if (Array.isArray(targets)) {
          const page = targets.find((t) => t.type === 'page' && t.url && t.url !== '' && t.url !== 'about:blank');
          if (page) {
            return page.url;
          }
        }
      } catch {
        // ignore parse error during startup
      }
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

function createTempUserDataDir(prefix = 'waveform-challenger-') {
  const dir = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.floor(Math.random() * 10000)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function test1_DevFallbackToDist() {
  console.log('\n[TEST 1] Stress-Testing Electron Dev Fallback when localhost:5173 is Offline...');
  const port = 9331;
  const userDir = createTempUserDataDir('test1-');
  
  const child = spawn(electronPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '.',
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    stdout += s;
    process.stdout.write(`[Test1 stdout] ${s}`);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    stderr += s;
    process.stderr.write(`[Test1 stderr] ${s}`);
  });

  try {
    const pageUrl = await fetchCdpPageUrl(port, 30, 400);
    console.log(`\n[TEST 1] Loaded Target Page URL: ${pageUrl}`);
    assert.ok(pageUrl, 'Electron window page URL must be resolved via CDP');
    assert.ok(
      pageUrl.startsWith('file:///') && pageUrl.includes('dist/index.html'),
      `Target URL must be dist/index.html, got: ${pageUrl}`
    );
    assert.ok(
      stdout.includes('Probing dev server') &&
      (stdout.includes('Loading local production bundle') || stdout.includes('Falling back')),
      'Stdout must record probe attempts and fallback loading'
    );
    console.log('[TEST 1 PASS] Electron cleanly fell back to dist/index.html when Vite was offline!');
  } finally {
    killProcessTree(child.pid);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
}

async function test2_DevFallbackCustomUnreachableUrl() {
  console.log('\n[TEST 2] Stress-Testing Fallback with Custom Unreachable VITE_DEV_SERVER_URL...');
  const port = 9332;
  const userDir = createTempUserDataDir('test2-');

  const child = spawn(electronPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '.',
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:59999',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    stdout += s;
    process.stdout.write(`[Test2 stdout] ${s}`);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    stderr += s;
    process.stderr.write(`[Test2 stderr] ${s}`);
  });

  try {
    const pageUrl = await fetchCdpPageUrl(port, 30, 400);
    console.log(`\n[TEST 2] Loaded Target Page URL: ${pageUrl}`);
    assert.ok(pageUrl, 'Electron window page URL must be resolved via CDP');
    assert.ok(
      pageUrl.startsWith('file:///') && pageUrl.includes('dist/index.html'),
      `Target URL must load dist/index.html on custom offline URL, got: ${pageUrl}`
    );
    console.log('[TEST 2 PASS] Unreachable custom VITE_DEV_SERVER_URL cleanly fell back to dist/index.html!');
  } finally {
    killProcessTree(child.pid);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
}

async function test3_RecoveryUiWhenDistMissing() {
  console.log('\n[TEST 3] Stress-Testing Recovery UI when dist/index.html is Missing...');
  assert.ok(fs.existsSync(distHtmlPath), 'dist/index.html must exist before test');
  fs.renameSync(distHtmlPath, distHtmlBakPath);

  const port = 9333;
  const userDir = createTempUserDataDir('test3-');
  let child = null;
  try {
    child = spawn(electronPath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDir}`,
      '.',
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(`[Test3 stdout] ${s}`);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(`[Test3 stderr] ${s}`);
    });

    const pageUrl = await fetchCdpPageUrl(port, 30, 400);
    console.log(`\n[TEST 3] Loaded Target URL: ${pageUrl ? pageUrl.slice(0, 100) : 'none'}...`);
    assert.ok(pageUrl, 'Electron window page URL must be resolved via CDP');
    assert.ok(
      pageUrl.startsWith('data:text/html'),
      `Target URL must be inline data URL recovery card, got: ${pageUrl}`
    );
    assert.ok(
      pageUrl.includes('WaveForm%20Desktop%20Launcher') ||
      pageUrl.includes('npm%20run%20dev') ||
      pageUrl.includes('dist%2Findex.html'),
      'Recovery URL must contain instructions for recovery'
    );
    console.log('[TEST 3 PASS] Recovery UI rendered successfully when dist/index.html was absent!');
  } finally {
    if (child) killProcessTree(child.pid);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
    if (fs.existsSync(distHtmlBakPath)) {
      fs.renameSync(distHtmlBakPath, distHtmlPath);
    }
    assert.ok(fs.existsSync(distHtmlPath), 'dist/index.html must be restored');
    console.log('[TEST 3] dist/index.html cleanly restored.');
  }
}

async function test4_DevLifecycleCleanShutdownOnElectronClose() {
  console.log('\n[TEST 4] Stress-Testing Process Lifecycle: Vite Shutdown on Electron Close...');
  
  // Wait up to 5s to ensure port 5173 is free before starting dev.mjs
  for (let i = 0; i < 10; i++) {
    const probe = await probeHttp('http://localhost:5173', 500);
    if (!probe.ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const initialProbe = await probeHttp('http://localhost:5173', 500);
  assert.equal(initialProbe.ok, false, 'Port 5173 must be free before starting dev.mjs');

  const devChild = spawn('node', ['scripts/dev.mjs'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let devStdout = '';
  let devStderr = '';
  devChild.stdout.on('data', (d) => {
    const s = d.toString();
    devStdout += s;
    process.stdout.write(`[dev.mjs stdout] ${s}`);
  });
  devChild.stderr.on('data', (d) => {
    const s = d.toString();
    devStderr += s;
    process.stderr.write(`[dev.mjs stderr] ${s}`);
  });

  try {
    // 1. Wait for dev.mjs to reach "Launching Electron desktop window..."
    console.log('[TEST 4] Waiting for dev.mjs compilation and Electron spawn...');
    let electronSpawned = false;
    for (let i = 0; i < 40; i++) {
      if (devStdout.includes('Launching Electron desktop window')) {
        electronSpawned = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(electronSpawned, 'dev.mjs must log "Launching Electron desktop window"');

    // 2. Verify Vite dev server is actively answering on port 5173
    const viteProbe = await probeHttp('http://localhost:5173', 1000);
    assert.ok(viteProbe.ok, 'Vite dev server must be actively serving HTTP on port 5173');
    console.log('[TEST 4] Vite server verified active on port 5173.');

    // 3. Find and terminate the Electron child process (simulating user closing the Electron app window)
    console.log('[TEST 4] Finding and terminating Electron child process to test automatic Vite shutdown...');
    const pwshGetChildren = `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${devChild.pid} } | Select-Object -ExpandProperty ProcessId`;
    const childPidsStr = execSync(`powershell -NoProfile -Command "${pwshGetChildren}"`, { encoding: 'utf8' }).trim();
    const childPids = childPidsStr.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    assert.ok(childPids.length > 0, 'Electron child process must be found under devChild');
    console.log(`[TEST 4] Found child PIDs under dev.mjs: ${childPids.join(', ')}. Terminating Electron...`);

    for (const pid of childPids) {
      killProcessTree(pid);
    }

    // 4. Wait for devChild to exit cleanly
    const exitPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('dev.mjs did not exit within 10s after Electron closed')), 10000);
      devChild.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    const devExitCode = await exitPromise;
    console.log(`[TEST 4] dev.mjs exited with code: ${devExitCode}`);

    // 5. Verify port 5173 is immediately released
    await new Promise((r) => setTimeout(r, 1000));
    const afterProbe = await probeHttp('http://localhost:5173', 500);
    assert.equal(afterProbe.ok, false, 'Port 5173 must be freed after Electron exits');
    console.log('[TEST 4 PASS] dev.mjs cleanly terminated Vite and freed port 5173 when Electron closed!');
  } finally {
    killProcessTree(devChild.pid);
  }
}

async function test5_DevLifecycleSignalTermination() {
  console.log('\n[TEST 5] Stress-Testing dev.mjs Process Tree Termination & Port Hygiene...');
  
  // Wait up to 5s to ensure port 5173 is free before starting dev.mjs
  for (let i = 0; i < 10; i++) {
    const probe = await probeHttp('http://localhost:5173', 500);
    if (!probe.ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const initialProbe = await probeHttp('http://localhost:5173', 500);
  assert.equal(initialProbe.ok, false, 'Port 5173 must be free before starting dev.mjs');

  const devChild = spawn('node', ['scripts/dev.mjs'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let devStdout = '';
  let devStderr = '';
  devChild.stdout.on('data', (d) => (devStdout += d.toString()));
  devChild.stderr.on('data', (d) => (devStderr += d.toString()));

  try {
    let electronSpawned = false;
    for (let i = 0; i < 40; i++) {
      if (devStdout.includes('Launching Electron desktop window')) {
        electronSpawned = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!electronSpawned) {
      console.error('[TEST 5 DEBUG] devStdout:', devStdout);
      console.error('[TEST 5 DEBUG] devStderr:', devStderr);
    }
    assert.ok(electronSpawned, 'dev.mjs must reach running state');

    let viteProbe = null;
    for (let i = 0; i < 5; i++) {
      viteProbe = await probeHttp('http://localhost:5173', 1500);
      if (viteProbe.ok) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!viteProbe?.ok) {
      console.error('[TEST 5 DEBUG] viteProbe failed:', viteProbe);
      console.error('[TEST 5 DEBUG] devStderr:', devStderr);
    }
    assert.ok(viteProbe?.ok, 'Vite dev server must be active');
    console.log('[TEST 5] Vite active on port 5173. Killing dev.mjs process tree...');

    killProcessTree(devChild.pid);
    await new Promise((r) => setTimeout(r, 1500));

    const afterProbe = await probeHttp('http://localhost:5173', 500);
    assert.equal(afterProbe.ok, false, 'Port 5173 must be freed after killing dev.mjs process tree');
    console.log('[TEST 5 PASS] Process tree termination cleanly frees port 5173 without lingering zombies!');
  } finally {
    killProcessTree(devChild.pid);
  }
}

async function test6_LauncherScriptsMultiDirectory() {
  console.log('\n[TEST 6] Stress-Testing Launcher Scripts from Different Directories...');

  // 6A: Test C:\Users\traps\waveform.cmd test from user home directory
  console.log('[TEST 6A] Testing C:\\Users\\traps\\waveform.cmd test from C:\\Users\\traps...');
  const outA = execSync('cmd /c "C:\\Users\\traps\\waveform.cmd test"', {
    cwd: 'C:\\Users\\traps',
    encoding: 'utf8',
  });
  assert.ok(outA.includes('311 passed') || outA.includes('ALL PASS'), 'waveform.cmd test must pass 311 tests from home dir');
  console.log('[TEST 6A PASS] waveform.cmd test succeeded from user home directory!');

  // 6B: Test C:\Users\traps\waveform.cmd test from C:\
  console.log('[TEST 6B] Testing C:\\Users\\traps\\waveform.cmd test from C:\\...');
  const outB = execSync('cmd /c "C:\\Users\\traps\\waveform.cmd test"', {
    cwd: 'C:\\',
    encoding: 'utf8',
  });
  assert.ok(outB.includes('311 passed') || outB.includes('ALL PASS'), 'waveform.cmd test must pass 311 tests from C:\\');
  console.log('[TEST 6B PASS] waveform.cmd test succeeded from root drive C:\\!');

  // 6C: Test C:\Users\traps\waveform.cmd typecheck from C:\Users\traps
  console.log('[TEST 6C] Testing C:\\Users\\traps\\waveform.cmd typecheck from C:\\Users\\traps...');
  const outC = execSync('cmd /c "C:\\Users\\traps\\waveform.cmd typecheck"', {
    cwd: 'C:\\Users\\traps',
    encoding: 'utf8',
  });
  assert.ok(!outC.includes('error TS'), 'typecheck must emit 0 errors');
  console.log('[TEST 6C PASS] waveform.cmd typecheck succeeded from user home directory!');

  // 6D: Test waveform.bat from a different directory (check directory switch)
  console.log('[TEST 6D] Testing waveform.bat directory resolution from C:\\Users\\traps...');
  const batPath = path.resolve(projectRoot, 'waveform.bat');
  assert.ok(fs.existsSync(batPath), 'waveform.bat must exist');
  const batContent = fs.readFileSync(batPath, 'utf8');
  assert.ok(batContent.includes('cd /d "%~dp0"'), 'waveform.bat must use cd /d "%~dp0"');
  assert.ok(batContent.includes('npm start'), 'waveform.bat must run npm start');
  console.log('[TEST 6D PASS] waveform.bat confirmed to change directory to its own location before executing npm start!');

  // 6E: Test waveform-dev.bat
  console.log('[TEST 6E] Testing waveform-dev.bat directory resolution...');
  const devBatPath = path.resolve(projectRoot, 'waveform-dev.bat');
  assert.ok(fs.existsSync(devBatPath), 'waveform-dev.bat must exist');
  const devBatContent = fs.readFileSync(devBatPath, 'utf8');
  assert.ok(devBatContent.includes('cd /d "%~dp0"'), 'waveform-dev.bat must use cd /d "%~dp0"');
  assert.ok(devBatContent.includes('npm run dev'), 'waveform-dev.bat must run npm run dev');
  console.log('[TEST 6E PASS] waveform-dev.bat confirmed to change directory to its own location before executing npm run dev!');
}

async function runAll() {
  console.log('================================================================');
  console.log('  CHALLENGER ADVERSARIAL STRESS TEST SUITE - MILESTONE M1');
  console.log('================================================================');
  const start = Date.now();

  try {
    await test1_DevFallbackToDist();
    await test2_DevFallbackCustomUnreachableUrl();
    await test3_RecoveryUiWhenDistMissing();
    await test4_DevLifecycleCleanShutdownOnElectronClose();
    await test5_DevLifecycleSignalTermination();
    await test6_LauncherScriptsMultiDirectory();

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log('\n================================================================');
    console.log(`[VERDICT: APPROVE] ALL 6 ADVERSARIAL STRESS TESTS PASSED IN ${duration}s!`);
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n================================================================');
    console.error('[VERDICT: CHALLENGE_REJECT] ADVERSARIAL TEST FAILED:');
    console.error(err);
    console.error('================================================================\n');
    process.exit(1);
  }
}

runAll();
