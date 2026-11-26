// tests/unit/power_tools_scrobble_lrc_hotkeys.test.mjs
// Unit tests for v1.3.2 Power Tools:
// 1. Native Last.fm MD5 signing + ListenBrainz submission + persistent offline retry queue
// 2. CustomLyricsStore (.lrc/.txt override, detection, per-track offset persistence, delete reset)
// 3. GlobalHotkeyManager (registration, conflict handling, master disable, resetDefaults, unregisterAll)
// 4. Direct delta updater PowerShell retry + cleanup hardening

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const {
  signLastFmParams,
  shouldCommitScrobble,
  validateListenBrainzToken,
  ScrobblerManager,
} = await import('../../electron/scrobbler.ts');

const { CustomLyricsStore, detectCustomLyricsFormat } = await import('../../electron/customLyricsStore.ts');

const {
  DEFAULT_GLOBAL_HOTKEYS,
  normalizeAccelerator,
  GlobalHotkeyManager,
} = await import('../../electron/globalHotkeys.ts');

const { buildDirectPatchApplierScript } = await import('../../electron/appUpdater.ts');

describe('v1.3.2 Power Tools: Scrobbling, Custom LRC, Hotkeys & Updater Hardening', () => {
  test('1. Last.fm MD5 signature excludes format/callback, sorts lexicographically, and matches specification', () => {
    const params = {
      track: 'Midnight City',
      artist: 'M83',
      method: 'track.scrobble',
      api_key: 'myApiKey',
      sk: 'mySessionKey',
      timestamp: '1700000000',
      format: 'json',
      callback: 'cb',
    };
    const secret = 'superSecretValue';
    const expectedRaw =
      'api_keymyApiKeyartistM83methodtrack.scrobbleskmySessionKeytimestamp1700000000trackMidnight City' +
      secret;
    const expectedMd5 = createHash('md5').update(expectedRaw, 'utf8').digest('hex');

    assert.equal(signLastFmParams(params, secret), expectedMd5);
  });

  test('2. shouldCommitScrobble enforces >=30s minimum track length and 50% or 240s threshold', () => {
    assert.equal(shouldCommitScrobble(20, 25), false); // Track shorter than 30s never scrobbles
    assert.equal(shouldCommitScrobble(80, 200), false); // < 50% (100s) and < 240s
    assert.equal(shouldCommitScrobble(100, 200), true); // Exactly 50%
    assert.equal(shouldCommitScrobble(240, 600), true); // >= 240s even if < 50% of 10-min track
    assert.equal(shouldCommitScrobble(35, 0), true); // Unknown duration falls back to 30s
  });

  test('3. ListenBrainz token validation and ScrobblerManager offline retry queue persist & flush', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-scrobble-test-'));
    try {
      const validateMock = async (url, init) => {
        assert.match(url, /validate-token$/);
        assert.equal(init.headers.Authorization, 'Token lb-secret-tok');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ valid: true, user_name: 'audiophile' }),
        };
      };
      const valRes = await validateListenBrainzToken('lb-secret-tok', validateMock);
      assert.equal(valRes.valid, true);
      assert.equal(valRes.userName, 'audiophile');

      let networkOnline = false;
      const submittedCalls = [];
      const mockFetch = async (url, init) => {
        if (!networkOnline) {
          throw new Error('ECONNREFUSED');
        }
        submittedCalls.push({ url, body: init.body });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: 'ok' }),
        };
      };

      const mgr = new ScrobblerManager(tmpDir, mockFetch);
      mgr.configure({
        listenBrainzEnabled: true,
        listenBrainzToken: 'lb-secret-tok',
        lastFmEnabled: true,
        lastFmApiKey: 'k1',
        lastFmApiSecret: 's1',
        lastFmSessionKey: 'sk1',
      });

      const offlineRes = await mgr.submitScrobble({
        title: 'Starlight Harbor',
        artist: 'WaveForm',
        album: 'Pulse',
        durationSec: 210,
        startedAtSec: 1700001000,
      });
      assert.equal(offlineRes.ok, false);
      assert.equal(offlineRes.queued, 2); // Queued both ListenBrainz and Last.fm
      assert.equal(mgr.getStatus().queueLength, 2);

      // Simulate restart from disk with network restored
      networkOnline = true;
      const mgr2 = new ScrobblerManager(tmpDir, mockFetch);
      assert.equal(mgr2.getQueueItems().length, 2);
      mgr2.configure({
        listenBrainzEnabled: true,
        listenBrainzToken: 'lb-secret-tok',
        lastFmEnabled: true,
        lastFmApiKey: 'k1',
        lastFmApiSecret: 's1',
        lastFmSessionKey: 'sk1',
      });
      const flushRes = await mgr2.flushQueue();
      assert.equal(flushRes.flushed, 2);
      assert.equal(flushRes.remaining, 0);
      assert.equal(submittedCalls.length, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('4. CustomLyricsStore persists .lrc/.txt overrides, per-track offsets, and clean resets', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-lrc-test-'));
    try {
      const store = new CustomLyricsStore(tmpDir);
      assert.equal(detectCustomLyricsFormat('[00:12.34] Hello'), 'lrc');
      assert.equal(detectCustomLyricsFormat('Plain verse line'), 'txt');

      const saved = store.saveCustomLyrics(
        'track_abc',
        '[00:05.00] First custom line\r\n[00:10.00] Second line',
        -250
      );
      assert.equal(saved.format, 'lrc');
      assert.equal(saved.offsetMs, -250);

      // Re-open store from disk
      const reloaded = new CustomLyricsStore(tmpDir);
      const rec = reloaded.getCustomLyrics('track_abc');
      assert.ok(rec);
      assert.equal(rec.format, 'lrc');
      assert.equal(rec.offsetMs, -250);
      assert.match(rec.rawText, /First custom line/);

      reloaded.setTrackOffsetMs('track_provider_only', 400);
      assert.equal(reloaded.getTrackOffsetMs('track_provider_only'), 400);

      assert.equal(reloaded.deleteCustomLyrics('track_abc'), true);
      assert.equal(reloaded.getCustomLyrics('track_abc'), null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('5. GlobalHotkeyManager detects duplicates/OS failures, supports resetDefaults & unregisterAll', () => {
    const registeredMap = new Map();
    const adapter = {
      register(accel, cb) {
        if (accel === 'CommandOrControl+Alt+Taken') return false;
        registeredMap.set(accel, cb);
        return true;
      },
      unregister(accel) {
        registeredMap.delete(accel);
      },
      unregisterAll() {
        registeredMap.clear();
      },
    };

    const triggered = [];
    const manager = new GlobalHotkeyManager(adapter, (action) => triggered.push(action));

    assert.equal(normalizeAccelerator('ctrl+alt+k'), 'CommandOrControl+Alt+K');

    const status = manager.applyConfig({
      enabled: true,
      bindings: {
        ...DEFAULT_GLOBAL_HOTKEYS,
        playPause: 'CommandOrControl+Alt+P',
        nextTrack: 'CommandOrControl+Alt+P', // duplicate!
        toggleKaraoke: 'CommandOrControl+Alt+Taken', // claimed by OS!
      },
    });
    assert.ok(status.conflicts.nextTrack);
    assert.ok(status.conflicts.toggleKaraoke);
    assert.equal(status.registered.playPause, 'CommandOrControl+Alt+P');

    registeredMap.get('CommandOrControl+Alt+P')?.();
    assert.deepEqual(triggered, ['playPause']);

    const resetStatus = manager.resetDefaults();
    assert.deepEqual(resetStatus.conflicts, {});
    assert.equal(Object.keys(resetStatus.registered).length, 7);

    manager.unregisterAll();
    assert.equal(registeredMap.size, 0);
  });

  test('6. Direct patch PowerShell script retries locked files and cleans UpdateDir on rollback', () => {
    const ps = buildDirectPatchApplierScript({
      targetPid: 1234,
      installDir: 'C:\\Program Files\\WaveForm',
      stagingDir: 'C:\\Temp\\wf\\staging',
      updateDir: 'C:\\Temp\\wf',
      relaunchExePath: 'C:\\Program Files\\WaveForm\\WaveForm.exe',
      targetVersion: '1.3.2',
      changedFiles: ['resources\\app.asar'],
      removedFiles: [],
    });
    assert.match(ps, /function Copy-WithRetry/);
    assert.match(ps, /function Remove-WithRetry/);
    assert.match(ps, /Copy-WithRetry \$src \$dst/);
    assert.match(ps, /catch \{[\s\S]*Remove-Item -LiteralPath \$UpdateDir -Recurse -Force/);
  });
});
