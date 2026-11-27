// scripts/bench-baseline.mjs
// Measures bundle/patch sizes, Electron cold-boot & idle RAM, and Rust waveform-core DSP/AutoEQ timings.
// Writes docs/PERF_BASELINE.md and cleanly terminates any spawned Electron child process.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version || '1.3.5';

const V134_APP_PATCH_BYTES = 29997800; // Measured WaveForm-AppPatch-1.3.4.zip baseline
const V134_FONT_OTF_BYTES = 11485556; // Measured 5 SF Pro Display .otf files before WOFF2 conversion

function fmtMb(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'N/A';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/A';
  return `${bytes.toLocaleString('en-US')} bytes`;
}

function dirSize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function measureFonts() {
  const fontsDir = path.join(ROOT, 'src', 'assets', 'fonts');
  const entries = fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir) : [];
  const sfProWoff2Bytes = entries
    .filter((n) => n.startsWith('sf_pro_display_') && n.endsWith('.woff2'))
    .reduce((acc, n) => acc + fs.statSync(path.join(fontsDir, n)).size, 0);
  const allFontsBytes = entries.reduce((acc, n) => acc + fs.statSync(path.join(fontsDir, n)).size, 0);
  return {
    sfProWoff2Bytes,
    allFontsBytes,
    savedBytes: Math.max(0, V134_FONT_OTF_BYTES - sfProWoff2Bytes),
  };
}

function measureNativeBenchmarks() {
  const nodeAddonPath = path.join(ROOT, 'native', 'waveform-core', 'waveform-core.win32-x64-msvc.node');
  if (!fs.existsSync(nodeAddonPath)) {
    return null;
  }
  const addon = require(nodeAddonPath);
  const dbPath = path.join(ROOT, 'src', 'assets', 'data', 'auto_eq.db');

  const t0 = performance.now();
  const status = addon.autoeqInit([dbPath]);
  const initMs = performance.now() - t0;

  const searchIters = 100;
  const s0 = performance.now();
  let lastHits = 0;
  for (let i = 0; i < searchIters; i++) {
    lastHits = addon.autoeqSearch('sony whch-720n', 10).length;
  }
  const searchAvgMs = (performance.now() - s0) / searchIters;

  const p0 = performance.now();
  for (let i = 0; i < searchIters; i++) {
    addon.autoeqFindProfile('7Hz Salnotes Zero');
  }
  const findAvgMs = (performance.now() - p0) / searchIters;

  const filters = [
    { type: 'LOW_SHELF', freq: 105, q: 0.71, gainDb: -3.2 },
    { type: 'PEAKING', freq: 240, q: 1.4, gainDb: 2.1 },
    { type: 'PEAKING', freq: 1000, q: 2.0, gainDb: -1.8 },
    { type: 'PEAKING', freq: 3400, q: 1.8, gainDb: 3.4 },
    { type: 'HIGH_SHELF', freq: 10000, q: 0.71, gainDb: 1.5 },
  ];
  const freqs = Array.from({ length: 128 }, (_, i) => 20 * Math.pow(1000, i / 127));
  const b0 = performance.now();
  const bqIters = 1000;
  for (let i = 0; i < bqIters; i++) {
    addon.computeBiquadMagnitudeDb(filters, freqs, 48000, -3.5);
  }
  const biquadAvgMs = (performance.now() - b0) / bqIters;

  const pcm = new Float32Array(2048);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.sin((2 * Math.PI * 110 * i) / 48000) * 0.5;
  }
  let bpmState;
  let prevMags;
  const a0 = performance.now();
  const frameIters = 500;
  for (let i = 0; i < frameIters; i++) {
    const res = addon.analyzeAudioFrame(pcm, 48000, prevMags, bpmState);
    bpmState = res.bpmState;
    prevMags = res.magnitudes;
  }
  const frameAvgMs = (performance.now() - a0) / frameIters;

  return {
    version: addon.nativeCoreVersion(),
    totalRows: status.totalRows,
    parametricRows: status.parametricRows,
    initMs,
    searchAvgMs,
    searchHits: lastHits,
    findAvgMs,
    biquadAvgMs,
    frameAvgMs,
  };
}

function queryProcessTreeMemoryWin(rootPid) {
  const psScript = `
    $procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount
    $seen = New-Object System.Collections.Generic.HashSet[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    $seen.Add(${rootPid}) | Out-Null
    $queue.Enqueue(${rootPid})
    while ($queue.Count -gt 0) {
      $cur = $queue.Dequeue()
      foreach ($p in $procs) {
        if ($p.ParentProcessId -eq $cur -and -not $seen.Contains([int]$p.ProcessId)) {
          $seen.Add([int]$p.ProcessId) | Out-Null
          $queue.Enqueue([int]$p.ProcessId)
        }
      }
    }
    $tree = $procs | Where-Object { $seen.Contains([int]$_.ProcessId) }
    $ws = ($tree | Measure-Object -Property WorkingSetSize -Sum).Sum
    $priv = ($tree | Measure-Object -Property PrivatePageCount -Sum).Sum
    $cnt = ($tree | Measure-Object).Count
    [PSCustomObject]@{ count = $cnt; workingSetBytes = [int64]$ws; privateBytes = [int64]$priv } | ConvertTo-Json -Compress
  `;
  const raw = execFileSync('powershell', ['-NoProfile', '-Command', psScript], {
    encoding: 'utf8',
    timeout: 8000,
  }).trim();
  return JSON.parse(raw);
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        timeout: 8000,
      });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited
    }
  }
}

async function measureElectronRuntime() {
  const unpackedExe = path.join(ROOT, 'release', 'win-unpacked', 'WaveForm.exe');
  const electronDistExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const useUnpacked = fs.existsSync(unpackedExe);
  const exePath = useUnpacked ? unpackedExe : electronDistExe;
  if (!fs.existsSync(exePath)) {
    return null;
  }

  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-bench-'));
  const args = useUnpacked
    ? [`--user-data-dir=${tempUserData}`, '--headless-bench']
    : [ROOT, `--user-data-dir=${tempUserData}`, '--headless-bench'];

  let child = null;
  const startMs = performance.now();
  try {
    child = spawn(exePath, args, {
      cwd: ROOT,
      detached: false,
      stdio: 'ignore',
      env: { ...process.env, WAVEFORM_BENCH_MODE: '1' },
    });

    const pid = child.pid;
    let bootMs = null;
    let lastSample = null;
    const deadline = startMs + 12000;

    // Poll until Electron renderer + GPU child processes stabilize (~3.5s after launch)
    while (performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 450));
      if (child.exitCode !== null) break;
      try {
        const mem = queryProcessTreeMemoryWin(pid);
        if (mem && mem.count >= 2 && bootMs === null) {
          bootMs = performance.now() - startMs;
        }
        if (mem && mem.workingSetBytes > 0) {
          lastSample = mem;
        }
        if (bootMs !== null && performance.now() - startMs >= Math.min(5500, bootMs + 2500)) {
          break;
        }
      } catch {
        // Retry next tick
      }
    }

    return {
      binary: useUnpacked ? 'release/win-unpacked/WaveForm.exe' : 'node_modules/electron/dist/electron.exe',
      processCount: lastSample?.count ?? 0,
      coldBootMs: bootMs ?? performance.now() - startMs,
      workingSetBytes: lastSample?.workingSetBytes ?? 0,
      privateBytes: lastSample?.privateBytes ?? 0,
    };
  } finally {
    if (child?.pid) {
      killProcessTree(child.pid);
    }
    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch {
      // Ignore cleanup lock race
    }
  }
}

async function main() {
  const fonts = measureFonts();
  const distBytes = dirSize(path.join(ROOT, 'dist'));
  const distElectronBytes = dirSize(path.join(ROOT, 'dist-electron'));
  const distAssetsBytes = dirSize(path.join(ROOT, 'dist', 'assets'));
  const unpackedBytes = dirSize(path.join(ROOT, 'release', 'win-unpacked'));
  const nodeAddonBytes = fileSize(
    path.join(ROOT, 'native', 'waveform-core', 'waveform-core.win32-x64-msvc.node')
  );
  const setupExeBytes = fileSize(path.join(ROOT, 'release', `WaveForm-Setup-${VERSION}.exe`));
  const portableExeBytes = fileSize(path.join(ROOT, 'release', `WaveForm-Portable-${VERSION}.exe`));
  const patchZipPath = path.join(ROOT, 'release', `WaveForm-AppPatch-${VERSION}.zip`);
  const patchZipBytes = fileSize(patchZipPath);
  const v134PatchFile = fileSize(path.join(ROOT, 'release', 'WaveForm-AppPatch-1.3.4.zip'));
  const baselinePatchBytes = v134PatchFile ?? V134_APP_PATCH_BYTES;

  const nativeBench = measureNativeBenchmarks();
  const electronBench = await measureElectronRuntime();

  const patchDeltaBytes = patchZipBytes !== null ? baselinePatchBytes - patchZipBytes : null;
  const patchDeltaPct =
    patchDeltaBytes !== null && baselinePatchBytes > 0
      ? ((patchDeltaBytes / baselinePatchBytes) * 100).toFixed(1)
      : null;

  const lines = [
    `# WaveForm Desktop v${VERSION} — Performance & Bundle Baseline`,
    '',
    `Generated: ${new Date().toISOString()} (${os.platform()} ${os.arch()}, Node ${process.version})`,
    '',
    '## 1. Bundle, Font & Release Artifact Sizes',
    '',
    '| Artifact | Size | Notes |',
    '| :--- | ---: | :--- |',
    `| \`src/assets/fonts/sf_pro_display_*.woff2\` (5 weights) | ${fmtMb(fonts.sfProWoff2Bytes)} | Down from ${fmtMb(V134_FONT_OTF_BYTES)} OTF (**-${fmtMb(fonts.savedBytes)} / -${((fonts.savedBytes / V134_FONT_OTF_BYTES) * 100).toFixed(1)}%**) |`,
    `| \`src/assets/fonts/\` (all bundled fonts) | ${fmtMb(fonts.allFontsBytes)} | Full Latin + accented + symbol glyph sets preserved |`,
    `| \`dist/\` | ${fmtMb(distBytes)} | Vite production web bundle |`,
    `| \`dist/assets/\` | ${fmtMb(distAssetsBytes)} | JS, CSS, and WOFF2/TTF font assets |`,
    `| \`dist-electron/\` | ${fmtMb(distElectronBytes)} | Compiled main & preload scripts |`,
    `| \`native/waveform-core/waveform-core.win32-x64-msvc.node\` | ${fmtMb(nodeAddonBytes ?? 0)} | Built from \`waveform-napi\` cdylib wrapping pure \`waveform-core\` |`,
    `| \`release/WaveForm-AppPatch-${VERSION}.zip\` | ${patchZipBytes !== null ? fmtMb(patchZipBytes) : 'Pending `npm run dist:win`'} | ${patchDeltaBytes !== null ? `vs v1.3.4 (${fmtMb(baselinePatchBytes)}): **-${fmtMb(patchDeltaBytes)} (-${patchDeltaPct}%)**` : `v1.3.4 baseline: ${fmtMb(baselinePatchBytes)}`} |`,
    `| \`release/WaveForm-Setup-${VERSION}.exe\` | ${setupExeBytes !== null ? fmtMb(setupExeBytes) : 'Pending `npm run dist:win`'} | NSIS differential installer |`,
    `| \`release/WaveForm-Portable-${VERSION}.exe\` | ${portableExeBytes !== null ? fmtMb(portableExeBytes) : 'Pending `npm run dist:win`'} | Standalone portable x64 build |`,
    `| \`release/win-unpacked/\` | ${unpackedBytes > 0 ? fmtMb(unpackedBytes) : 'Pending `npm run dist:win`'} | Unpacked desktop runtime footprint |`,
    '',
    '## 2. Electron Runtime Footprint (Isolated Cold Boot)',
    '',
  ];

  if (electronBench) {
    lines.push(
      '| Metric | Measured Value | Notes |',
      '| :--- | ---: | :--- |',
      `| Executable | \`${electronBench.binary}\` | Spawned with clean temporary \`--user-data-dir\` and terminated |`,
      `| Cold Boot Process Tree Init | ${electronBench.coldBootMs.toFixed(0)} ms | Time until multi-process tree active (${electronBench.processCount} processes) |`,
      `| Idle Working Set (RAM) | ${fmtMb(electronBench.workingSetBytes)} | Summed across Electron process tree (${fmtBytes(electronBench.workingSetBytes)}) |`,
      `| Idle Private Bytes | ${fmtMb(electronBench.privateBytes)} | Summed commit charge across tree (${fmtBytes(electronBench.privateBytes)}) |`,
      ''
    );
  } else {
    lines.push('_Electron binary not found; skipped runtime measurement._', '');
  }

  lines.push('## 3. Native Rust `waveform-core` Microbenchmarks (Release Build)', '');
  if (nativeBench) {
    lines.push(
      '| Operation | Timing / Throughput | Details |',
      '| :--- | ---: | :--- |',
      `| \`autoeqInit\` | ${nativeBench.initMs.toFixed(2)} ms | Cold SQLite load + trigram index (${nativeBench.totalRows.toLocaleString('en-US')} rows, ${nativeBench.parametricRows.toLocaleString('en-US')} parametric) |`,
      `| \`autoeqSearch("sony whch-720n")\` | ${nativeBench.searchAvgMs.toFixed(3)} ms | 100-iter avg (${nativeBench.searchHits} ranked matches) |`,
      `| \`autoeqFindProfile("7Hz Salnotes Zero")\` | ${nativeBench.findAvgMs.toFixed(3)} ms | 100-iter avg including \`PaP\\x01\` decode |`,
      `| \`computeBiquadMagnitudeDb\` | ${nativeBench.biquadAvgMs.toFixed(4)} ms | 1,000-iter avg (5 biquad bands x 128 log freqs) |`,
      `| \`analyzeAudioFrame\` | ${nativeBench.frameAvgMs.toFixed(4)} ms | 500-iter avg (2048-sample FFT @ 48 kHz + BPM tracker) |`,
      ''
    );
  } else {
    lines.push('_Native addon binary not built yet; run `npm run build:rust` first._', '');
  }

  const outPath = path.join(ROOT, 'docs', 'PERF_BASELINE.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[bench:baseline] Wrote ${path.relative(ROOT, outPath)}`);
  console.log(
    `[bench:baseline] Fonts saved: ${fmtMb(fonts.savedBytes)}; Patch zip: ${patchZipBytes !== null ? fmtMb(patchZipBytes) : 'N/A'}; Electron idle RAM: ${electronBench ? fmtMb(electronBench.workingSetBytes) : 'N/A'}`
  );
}

main().catch((err) => {
  console.error('[bench:baseline] Failed:', err);
  process.exitCode = 1;
});
