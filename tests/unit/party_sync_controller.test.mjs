// tests/unit/party_sync_controller.test.mjs
// Unit tests for Listen Together 5-sample median NTP estimator and 3-zone zero-loop drift controller

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve('.');
const resolverHook = `
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const require = createRequire(${JSON.stringify(pathToFileURL(path.join(rootDir, 'package.json')).href)});
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); } catch (err) {
    if (specifier.startsWith('.')) {
      for (const sfx of ['.ts', '.tsx', '/index.ts']) {
        try { return await nextResolve(specifier + sfx, context); } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { PartyDriftController, PartySyncClient } = await import('../../src/services/PartySyncClient.ts');

describe('Listen Together 5-Sample NTP & 3-Zone Zero-Loop Sync Controller', () => {
  test('5-sample median RTT/offset rejects transient network spikes cleanly', () => {
    const ctrl = new PartyDriftController();
    // 4 clean samples around +100ms offset, RTT 40ms; 1 huge RTT outlier spike (900ms)
    ctrl.recordPong(1000, 1120, 1040); // rtt 40, off +100
    ctrl.recordPong(2000, 2118, 2042); // rtt 42, off +97
    ctrl.recordPong(3000, 3050, 3900); // rtt 900 outlier, off -400
    ctrl.recordPong(4000, 4122, 4040); // rtt 40, off +102
    const telemetry = ctrl.recordPong(5000, 5119, 5041); // rtt 41, off +99

    assert.equal(telemetry.isClockSynced, true);
    assert.equal(telemetry.rttMs, 41);
    assert.equal(telemetry.clockOffsetMs, 99);
  });

  test('Zone 1 deadzone (<150ms) stays locked at 1.00x with zero seeks', () => {
    const ctrl = new PartyDriftController();
    const a1 = ctrl.evaluate(10080, 10000, 1000);
    assert.equal(a1.action, 'none');
    assert.equal(a1.playbackRate, 1.0);
    assert.equal(a1.zone, 'locked');

    const a2 = ctrl.evaluate(9880, 10000, 2000);
    assert.equal(a2.action, 'none');
    assert.equal(a2.playbackRate, 1.0);
  });

  test('Zone 2 (0.15s-2.2s) uses pitch-preserving rate catchup with zero seeks and settles under 80ms', () => {
    const ctrl = new PartyDriftController();
    // Guest ahead by +800ms -> slow to 0.94x (no seek!)
    const ahead = ctrl.evaluate(20800, 20000, 1000);
    assert.equal(ahead.action, 'rate');
    assert.equal(ahead.playbackRate, 0.94);
    assert.equal(ahead.zone, 'rate_catchup');

    // Hysteresis keeps rate while still 100ms (> 80ms settle threshold)
    const midSettle = ctrl.evaluate(20100, 20000, 2000);
    assert.equal(midSettle.action, 'rate');
    assert.equal(midSettle.playbackRate, 0.94);

    // Once within +/-80ms, resets back to 1.00x
    const settled = ctrl.evaluate(20050, 20000, 3000);
    assert.equal(settled.action, 'rate');
    assert.equal(settled.playbackRate, 1.0);
    assert.equal(settled.zone, 'locked');

    // Guest behind by -900ms -> speed up to 1.06x
    const behind = ctrl.evaluate(29100, 30000, 4000);
    assert.equal(behind.action, 'rate');
    assert.equal(behind.playbackRate, 1.06);
  });

  test('Zone 3 ahead (2.2s-4.5s) pauses cleanly to wait for host and never seeks backward in a loop', () => {
    const ctrl = new PartyDriftController();
    const wait1 = ctrl.evaluate(43000, 40000, 1000); // +3.0s ahead
    assert.equal(wait1.action, 'pause_wait');
    assert.equal(wait1.zone, 'pause_wait');

    // Still ahead by 500ms -> stays waiting
    const wait2 = ctrl.evaluate(43000, 42500, 3500);
    assert.equal(wait2.action, 'pause_wait');

    // Host arrives within <=120ms -> resumes cleanly at 1.0x
    const resume = ctrl.evaluate(43000, 42940, 3940);
    assert.equal(resume.action, 'resume');
    assert.equal(resume.playbackRate, 1.0);
    assert.equal(resume.zone, 'locked');
  });

  test('Zone 3 behind/extreme desync fires ONE +350ms lead-compensated seek and locks a 4.5s cooldown latch', () => {
    const client = new PartySyncClient();
    const seeks = [];
    const rates = [];
    const pauses = [];
    client.setCallbacks({
      onSeek: (pos) => seeks.push(pos),
      onPlaybackRateRequested: (r) => rates.push(r),
      onPauseWaitChanged: (w) => pauses.push(w),
    });

    // Establish ~0ms offset via pong using current wall clock
    const now = Date.now();
    client.handleFrame({ type: 'pong', clientMs: now, serverMs: now });
    const playback = {
      isPlaying: true,
      positionMs: 50000,
      anchorMs: now,
      speed: 1.0,
      currentTrack: { videoId: 'v1', title: 'T', artist: 'A', durationMs: 180000 },
    };

    // Guest behind by 3.5s -> single lead-compensated seek (+350ms -> ~50350ms)
    const triggered = client.checkDrift(46500, playback, now);
    assert.equal(triggered, true);
    assert.equal(seeks.length, 1);
    assert.ok(seeks[0] >= 50300 && seeks[0] <= 50450, `Expected ~50350ms, got ${seeks[0]}`);

    // 1.0s later during 4.5s cooldown latch: even if buffer still lags, ZERO repeated seeks!
    client.checkDrift(47200, playback, now + 1000);
    assert.equal(seeks.length, 1, 'Seek cooldown latch must prevent repeated seek loops');
  });
});
