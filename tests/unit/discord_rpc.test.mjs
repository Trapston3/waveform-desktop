// tests/unit/discord_rpc.test.mjs
// Unit & IPC Integration tests for Discord Rich Presence (WS11)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.')) {
      if (specifier.endsWith('.js')) {
        try {
          return await nextResolve(specifier.slice(0, -3) + '.ts', context);
        } catch {}
      }
      if (!specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
        try {
          return await nextResolve(specifier + '.ts', context);
        } catch {}
        try {
          return await nextResolve(specifier + '/index.ts', context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const {
  DISCORD_DEFAULT_CLIENT_ID,
  GET_WAVEFORM_URL,
  DiscordRpcService,
  encodeDiscordFrame,
  decodeDiscordFrames,
  clampDiscord,
  resolveDiscordSafeArtworkUrl,
  buildDiscordActivityPayload,
} = await import('../../src/services/DiscordRpcService.ts');

const {
  DISCORD_OP_HANDSHAKE,
  DISCORD_OP_FRAME,
  DISCORD_OP_CLOSE,
  DISCORD_OP_PING,
  DISCORD_OP_PONG,
  DiscordRpcManager,
  getDiscordIpcPipePaths,
} = await import('../../electron/discordRpc.ts');

describe('WS11: Discord Rich Presence', () => {
  test('DRPC-01: Renderer service has zero node:net / node:crypto imports and uses default client ID', () => {
    const srcText = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/DiscordRpcService.ts'),
      'utf8'
    );
    assert.ok(!srcText.includes('node:net'), 'Renderer service must not import node:net');
    assert.ok(!srcText.includes('node:crypto'), 'Renderer service must not import node:crypto');
    assert.strictEqual(DISCORD_DEFAULT_CLIENT_ID, '1574112665163530280');
  });

  test('DRPC-02: Binary frame codec encodes and decodes split/coalesced frames cleanly', () => {
    const f1 = encodeDiscordFrame(0, { v: 1, client_id: DISCORD_DEFAULT_CLIENT_ID });
    const f2 = encodeDiscordFrame(1, { cmd: 'SET_ACTIVITY', nonce: 'abc' });
    const combined = new Uint8Array(f1.length + f2.length);
    combined.set(f1, 0);
    combined.set(f2, f1.length);

    // Split mid-frame to test partial reassembly
    const part1 = combined.subarray(0, f1.length + 5);
    const part2 = combined.subarray(f1.length + 5);

    const d1 = decodeDiscordFrames(part1);
    assert.strictEqual(d1.frames.length, 1);
    assert.strictEqual(d1.frames[0].opcode, 0);
    assert.strictEqual(d1.frames[0].payload.client_id, DISCORD_DEFAULT_CLIENT_ID);
    assert.strictEqual(d1.remaining.length, 5);

    const merged = new Uint8Array(d1.remaining.length + part2.length);
    merged.set(d1.remaining, 0);
    merged.set(part2, d1.remaining.length);

    const d2 = decodeDiscordFrames(merged);
    assert.strictEqual(d2.frames.length, 1);
    assert.strictEqual(d2.frames[0].opcode, 1);
    assert.strictEqual(d2.frames[0].payload.cmd, 'SET_ACTIVITY');
    assert.strictEqual(d2.remaining.length, 0);
  });

  test('DRPC-03: clampDiscord enforces [minLen, maxLen] bounds safely', () => {
    const short = clampDiscord('X', 2, 128);
    assert.ok(short.length >= 2 && short.length <= 128);

    const empty = clampDiscord('', 2, 128);
    assert.ok(empty.length >= 2 && empty.length <= 128);

    const long = clampDiscord('A'.repeat(250), 2, 128);
    assert.strictEqual(long.length, 128);
    assert.ok(long.endsWith('…'));
  });

  test('DRPC-04: resolveDiscordSafeArtworkUrl normalizes YouTube URLs and rejects local/private schemes', () => {
    assert.strictEqual(
      resolveDiscordSafeArtworkUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', 'dQw4w9WgXcQ'),
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    );
    assert.strictEqual(
      resolveDiscordSafeArtworkUrl(null, 'dQw4w9WgXcQ', false),
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    );
    assert.strictEqual(
      resolveDiscordSafeArtworkUrl('waveform-local://art?key=abc', 'local_1', true),
      'waveform_logo'
    );
    assert.strictEqual(
      resolveDiscordSafeArtworkUrl('file:///C:/Music/cover.jpg', 'local_1', true),
      'waveform_logo'
    );
    assert.strictEqual(
      resolveDiscordSafeArtworkUrl('http://localhost:3000/cover.png', 'track1', false),
      'waveform_logo'
    );
    assert.strictEqual(
      resolveDiscordSafeArtworkUrl('https://cdn.example.com/art/cover.jpg', 'track1', false),
      'https://cdn.example.com/art/cover.jpg'
    );
  });

  test('DRPC-05: buildDiscordActivityPayload matches exact Discord activity contract', () => {
    const nowMs = 1700000100000;
    const playing = buildDiscordActivityPayload(
      {
        videoId: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        albumName: 'Whenever You Need Somebody',
        thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
        sourceQuality: '24-bit / 96kHz FLAC',
        durationSec: 213,
        positionMs: 30000,
        isPlaying: true,
        isLocal: false,
      },
      { displayFormat: 'song_on_waveform', nowMs }
    );

    assert.strictEqual('name' in playing, false, 'Activity MUST NOT contain name property');
    assert.strictEqual(playing.type, 2);
    assert.strictEqual(playing.status_display_type, 2);
    assert.strictEqual(playing.details, 'Never Gonna Give You Up on WaveForm');
    assert.strictEqual(playing.state, 'by Rick Astley');
    assert.ok(playing.timestamps && typeof playing.timestamps.start === 'number' && typeof playing.timestamps.end === 'number');
    assert.strictEqual(playing.timestamps.start, Math.floor(nowMs / 1000 - 30));
    assert.strictEqual(playing.timestamps.end, Math.floor(nowMs / 1000 + 183));
    assert.strictEqual(playing.assets.large_image, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(playing.assets.small_image, 'waveform_play');
    assert.strictEqual(playing.assets.small_text, '24-bit / 96kHz FLAC • WaveForm');
    assert.strictEqual(playing.buttons?.length, 2);
    assert.strictEqual(playing.buttons?.[0].url, 'https://music.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(playing.buttons?.[1].label, 'Get WaveForm');
    assert.strictEqual(playing.buttons?.[1].url, GET_WAVEFORM_URL);

    // Paused omits timestamps and switches small_image/small_text
    const paused = buildDiscordActivityPayload(
      {
        videoId: 'local_123',
        title: 'Midnight City',
        artist: 'M83',
        durationSec: 240,
        positionMs: 50000,
        isPlaying: false,
        isLocal: true,
        partyCode: 'X7K9P2',
      },
      { displayFormat: 'artist', nowMs }
    );
    assert.strictEqual(paused.status_display_type, 1);
    assert.strictEqual(paused.timestamps, undefined);
    assert.strictEqual(paused.assets.small_image, 'waveform_pause');
    assert.strictEqual(paused.assets.small_text, 'Paused • WaveForm');
    assert.strictEqual(paused.buttons?.[0].label, 'Listen Together (X7K9P2)');
    assert.strictEqual(paused.buttons?.[1].label, 'Get WaveForm');
  });

  test('DRPC-06: getDiscordIpcPipePaths returns platform-correct pipe candidates', () => {
    const winPipes = getDiscordIpcPipePaths('win32', {});
    assert.strictEqual(winPipes.length, 10);
    assert.strictEqual(winPipes[0], '\\\\?\\pipe\\discord-ipc-0');
    assert.strictEqual(winPipes[9], '\\\\?\\pipe\\discord-ipc-9');

    const linuxPipes = getDiscordIpcPipePaths('linux', { XDG_RUNTIME_DIR: '/run/user/1000' });
    assert.ok(linuxPipes.some((p) => p === path.join('/run/user/1000', 'discord-ipc-0')));
    assert.ok(linuxPipes.some((p) => p === path.join('/tmp', 'discord-ipc-0')));
  });

  test('DRPC-07: DiscordRpcManager connects to mock pipe, handles READY, PING->PONG, status_display_type fallback, and shutdown clear', async () => {
    const pipePath =
      process.platform === 'win32'
        ? `\\\\?\\pipe\\waveform-discord-test-${process.pid}-${Date.now()}`
        : path.join(os.tmpdir(), `waveform-discord-test-${process.pid}-${Date.now()}.sock`);

    const receivedFrames = [];
    let rejectFirstStatusDisplayType = true;

    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const { frames, remaining } = decodeDiscordFrames(buf);
        buf = Buffer.from(remaining);

        for (const frame of frames) {
          receivedFrames.push(frame);
          if (frame.opcode === DISCORD_OP_HANDSHAKE) {
            socket.write(
              encodeDiscordFrame(DISCORD_OP_FRAME, {
                cmd: 'DISPATCH',
                evt: 'READY',
                data: { v: 1, user: { username: 'TestUser' } },
              })
            );
            // Send a PING to test auto-PONG response
            socket.write(encodeDiscordFrame(DISCORD_OP_PING, { ts: 42 }));
          } else if (frame.opcode === DISCORD_OP_FRAME && frame.payload?.cmd === 'SET_ACTIVITY') {
            const act = frame.payload?.args?.activity;
            if (rejectFirstStatusDisplayType && act && 'status_display_type' in act) {
              rejectFirstStatusDisplayType = false;
              socket.write(
                encodeDiscordFrame(DISCORD_OP_FRAME, {
                  cmd: 'SET_ACTIVITY',
                  evt: 'ERROR',
                  nonce: frame.payload.nonce,
                  data: { code: 4000, message: 'Invalid field status_display_type' },
                })
              );
            }
          }
        }
      });
    });

    await new Promise((resolve) => server.listen(pipePath, resolve));

    const mgr = new DiscordRpcManager({
      enabled: true,
      pipePaths: [pipePath],
    });

    try {
      const ok = await mgr.update({
        videoId: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        durationSec: 213,
        positionMs: 12000,
        isPlaying: true,
      });
      assert.strictEqual(ok, true);
      assert.strictEqual(mgr.getStatus().connected, true);

      // Wait briefly for PING->PONG and status_display_type error fallback roundtrip
      await new Promise((r) => setTimeout(r, 150));

      const pongs = receivedFrames.filter((f) => f.opcode === DISCORD_OP_PONG);
      assert.ok(pongs.length >= 1, 'Manager must reply OP 4 PONG to OP 3 PING');
      assert.strictEqual(pongs[0].payload.ts, 42);

      const activities = receivedFrames.filter(
        (f) => f.opcode === DISCORD_OP_FRAME && f.payload?.cmd === 'SET_ACTIVITY'
      );
      assert.ok(activities.length >= 2, 'Should resend SET_ACTIVITY after status_display_type rejection');
      assert.strictEqual('status_display_type' in activities[0].payload.args.activity, true);
      assert.strictEqual('status_display_type' in activities[1].payload.args.activity, false);
      assert.strictEqual('name' in activities[1].payload.args.activity, false);

      mgr.shutdown();
      await new Promise((r) => setTimeout(r, 80));

      const clearFrame = receivedFrames.find(
        (f) =>
          f.opcode === DISCORD_OP_FRAME &&
          f.payload?.cmd === 'SET_ACTIVITY' &&
          f.payload?.args?.activity === null
      );
      const closeFrame = receivedFrames.find((f) => f.opcode === DISCORD_OP_CLOSE);
      assert.ok(clearFrame, 'Shutdown must send SET_ACTIVITY with activity: null');
      assert.ok(closeFrame, 'Shutdown must send OP 2 CLOSE');
    } finally {
      mgr.shutdown();
      await new Promise((resolve) => server.close(resolve));
      if (process.platform !== 'win32' && fs.existsSync(pipePath)) {
        fs.unlinkSync(pipePath);
      }
    }
  });

  test('DRPC-08: DiscordRpcManager and DiscordRpcService fail gracefully when Discord is closed', async () => {
    const mgr = new DiscordRpcManager({
      enabled: true,
      pipePaths: ['\\\\?\\pipe\\nonexistent-waveform-discord-9999'],
    });
    const ok = await mgr.connect();
    assert.strictEqual(ok, false);
    assert.strictEqual(mgr.getStatus().connected, false);
    mgr.shutdown();

    const svc = new DiscordRpcService();
    const svcOk = await svc.connect();
    assert.strictEqual(svcOk, false);
    svc.disconnect();
  });
});
