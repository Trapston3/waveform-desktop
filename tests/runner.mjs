// tests/runner.mjs
// WaveForm Windows Desktop Client - Unified 4-Tier Test Runner

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const tierDefinitions = [
  {
    tier: 1,
    name: 'Tier 1 - Feature Coverage',
    description: 'Isolated verification of all 27 features in PROJECT.md',
    targetMin: 135,
    files: [
      path.join(__dirname, 'tier1_features', 'feature01_to_05.test.mjs'),
      path.join(__dirname, 'tier1_features', 'feature06_to_10.test.mjs'),
      path.join(__dirname, 'tier1_features', 'feature11_to_15.test.mjs'),
      path.join(__dirname, 'tier1_features', 'feature16_to_20.test.mjs'),
      path.join(__dirname, 'tier1_features', 'feature21_to_27.test.mjs'),
    ],
  },
  {
    tier: 2,
    name: 'Tier 2 - Boundary & Corner Cases',
    description: 'Adversarial edge conditions, empty inputs, nulls, clipping across 27 features',
    targetMin: 135,
    files: [
      path.join(__dirname, 'tier2_boundaries', 'boundary_01_to_05.test.mjs'),
      path.join(__dirname, 'tier2_boundaries', 'boundary_06_to_10.test.mjs'),
      path.join(__dirname, 'tier2_boundaries', 'boundary_11_to_15.test.mjs'),
      path.join(__dirname, 'tier2_boundaries', 'boundary_16_to_20.test.mjs'),
      path.join(__dirname, 'tier2_boundaries', 'boundary_21_to_27.test.mjs'),
    ],
  },
  {
    tier: 3,
    name: 'Tier 3 - Cross-Feature Combinations',
    description: 'Pairwise feature interaction & state synchronization tests',
    targetMin: 27,
    files: [
      path.join(__dirname, 'tier3_combinations', 'pairwise_interactions.test.mjs'),
    ],
  },
  {
    tier: 4,
    name: 'Tier 4 - Real-World Application Scenarios',
    description: 'End-to-end multi-step realistic user workflows and client lifecycle',
    targetMin: 14,
    files: [
      path.join(__dirname, 'tier4_scenarios', 'realworld_workflows.test.mjs'),
    ],
  },
];

// Parse CLI flags
const args = process.argv.slice(2);
let selectedTier = null;
const tierArg = args.find((a) => a.startsWith('--tier='));
if (tierArg) {
  selectedTier = parseInt(tierArg.split('=')[1], 10);
}

const isVerbose = args.includes('--verbose') || args.includes('-v');

console.log('='.repeat(80));
console.log('  WAVEFORM WINDOWS DESKTOP CLIENT - 4-TIER E2E TEST RUNNER');
console.log('='.repeat(80));
console.log(`Working Directory: ${rootDir}`);
console.log(`Node Version     : ${process.version}`);
console.log(`Platform         : ${process.platform} (${process.arch})`);
console.log(`Filter Mode      : ${selectedTier ? `Tier ${selectedTier} only` : 'All Tiers (1 to 4)'}`);
console.log('-'.repeat(80));

const tiersToRun = selectedTier
  ? tierDefinitions.filter((t) => t.tier === selectedTier)
  : tierDefinitions;

if (tiersToRun.length === 0) {
  console.error(`Error: Unknown tier ${selectedTier}. Valid options are --tier=1, 2, 3, or 4.`);
  process.exit(1);
}

const tierResults = [];
let overallPass = 0;
let overallFail = 0;
const startTime = Date.now();

for (const tierDef of tiersToRun) {
  process.stdout.write(`Executing ${tierDef.name}... `);
  const tierStart = Date.now();

  const nodeArgs = ['--test', '--test-reporter=tap', ...tierDef.files];
  const proc = spawnSync(process.execPath, nodeArgs, {
    cwd: rootDir,
    encoding: 'utf-8',
    env: { ...process.env },
  });

  const durationMs = Date.now() - tierStart;
  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';
  const cleanStdout = stdout.replace(/\x1b\[[0-9;]*m/g, '');

  // Parse pass/fail counts from node:test summary (supports both TAP `#` and spec `ℹ` reporters)
  const passMatch = cleanStdout.match(/(?:ℹ|#)\s+pass\s+(\d+)/);
  const failMatch = cleanStdout.match(/(?:ℹ|#)\s+fail\s+(\d+)/);
  const totalMatch = cleanStdout.match(/(?:ℹ|#)\s+tests\s+(\d+)/);

  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : (proc.status !== 0 ? 1 : 0);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : passed + failed;

  overallPass += passed;
  overallFail += failed;

  tierResults.push({
    tier: tierDef.tier,
    name: tierDef.name,
    targetMin: tierDef.targetMin,
    total,
    passed,
    failed,
    durationMs,
    exitCode: proc.status,
  });

  if (proc.status === 0 && failed === 0) {
    console.log(`[PASS] (${passed}/${total} tests passed in ${durationMs}ms)`);
  } else {
    console.log(`[FAIL] (${failed} failed, ${passed} passed)`);
    if (isVerbose || !selectedTier) {
      console.log('\n--- Failure Output ---');
      console.log(stdout);
      console.error(stderr);
      console.log('----------------------\n');
    }
  }
}

const totalDurationMs = Date.now() - startTime;

console.log('\n' + '='.repeat(80));
console.log('                      TEST EXECUTION SUMMARY TABLE');
console.log('='.repeat(80));
console.log(
  'Tier'.padEnd(8) +
  'Tier Name'.padEnd(40) +
  'Target'.padEnd(10) +
  'Passed'.padEnd(10) +
  'Status'.padEnd(10) +
  'Time'
);
console.log('-'.repeat(80));

for (const res of tierResults) {
  const statusStr = res.failed === 0 && res.passed >= res.targetMin ? 'PASS' : 'FAIL';
  console.log(
    `Tier ${res.tier}`.padEnd(8) +
    res.name.padEnd(40) +
    `>= ${res.targetMin}`.padEnd(10) +
    `${res.passed}/${res.total}`.padEnd(10) +
    statusStr.padEnd(10) +
    `${res.durationMs}ms`
  );
}

console.log('-'.repeat(80));
const totalTarget = tiersToRun.reduce((acc, t) => acc + t.targetMin, 0);
const allPassed = overallFail === 0 && overallPass >= totalTarget;
const passRate = overallPass + overallFail > 0
  ? ((overallPass / (overallPass + overallFail)) * 100).toFixed(1)
  : '0.0';

console.log(
  'TOTAL'.padEnd(8) +
  `All Executed Tiers (${tiersToRun.length} tiers)`.padEnd(40) +
  `>= ${totalTarget}`.padEnd(10) +
  `${overallPass}/${overallPass + overallFail}`.padEnd(10) +
  (allPassed ? 'ALL PASS' : 'FAIL').padEnd(10) +
  `${totalDurationMs}ms`
);
console.log('='.repeat(80));
console.log(`Final Result: ${allPassed ? 'SUCCESS - ALL TESTS PASSED' : 'FAILURE - ONE OR MORE TESTS FAILED'}`);
console.log(`Pass Rate   : ${passRate}% (${overallPass} passed, ${overallFail} failed)`);
console.log('='.repeat(80) + '\n');

process.exit(allPassed ? 0 : 1);
