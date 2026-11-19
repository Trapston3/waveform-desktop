import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync('electron/main.ts', 'utf8');
const preload = fs.readFileSync('electron/preload.cts', 'utf8');
const view = fs.readFileSync('src/ui/views/LocalMediaView.tsx', 'utf8');

test('main registers privileged waveform-local protocol with Range support', () => {
  assert.match(main, /registerSchemesAsPrivileged/);
  assert.match(main, /protocol\??\.handle\('waveform-local'/);
  assert.match(main, /status: 206/);
  assert.match(main, /Content-Range/);
  assert.match(main, /Accept-Ranges/);
});

test('main exposes folder, scan and account IPC', () => {
  for (const ch of ['select-local-folder', 'scan-local-folder', 'account-login', 'account-status', 'account-logout']) {
    assert.ok(main.includes(`'${ch}'`), ch);
  }
  assert.match(main, /SAPISID/);
  assert.match(main, /sp_dc/);
});

test('preload bridges all new APIs', () => {
  for (const fn of ['selectLocalFolder', 'scanLocalFolder', 'loginYouTubeMusic', 'loginSpotify', 'getAccountAuthStatus', 'logoutAccount']) {
    assert.ok(preload.includes(`${fn}:`), fn);
  }
});

test('LocalMediaView no longer passes null scanner and has Browse button', () => {
  assert.doesNotMatch(view, /null as any, folderPath/);
  assert.match(view, /scanLocalFolder/);
  assert.match(view, /Browse\.\.\./);
  assert.match(view, /selectLocalFolder/);
});
