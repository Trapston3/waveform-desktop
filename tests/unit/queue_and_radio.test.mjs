// tests/unit/queue_and_radio.test.mjs
// Unit tests for strict music radio filtering, user-queue vs autoplay isolation, reordering, and item removal.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

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

const { filterMusicRadioTracks } = await import(
  pathToFileURL(path.join(rootDir, 'src/services/MusicService.ts')).href
);
const { InnerTubeParser } = await import(
  pathToFileURL(path.join(rootDir, 'src/services/InnerTubeParser.ts')).href
);
const { useQueueStore } = await import(
  pathToFileURL(path.join(rootDir, 'src/state/queueStore.ts')).href
);

const makeSong = (id, title, artist, extra = {}) => ({
  videoId: id,
  id,
  title,
  artist,
  durationSec: 210,
  thumbnail: '',
  ...extra,
});

describe('Search Queue Pollution Fix, Radio Filtering & Interactive Queue Store', () => {
  beforeEach(() => {
    useQueueStore.getState().clearQueue();
  });

  test('filterMusicRadioTracks strips podcasts, >15min shows, seed duplicates, and title-spam covers', () => {
    const seed = makeSong('seed_1', 'Viva La Vida', 'Coldplay');
    const candidates = [
      makeSong('seed_1', 'Viva La Vida', 'Coldplay'), // duplicate seed
      makeSong('pod_1', 'VIVA LA MODA PODCAST Ep 42', 'Moda Host', { isPodcast: true, durationSec: 1800 }),
      makeSong('long_1', 'Full Concert Documentary', 'Archive', { durationSec: 2400 }),
      makeSong('cover_1', 'Viva La Vida', 'Wedding Cover Band', { durationSec: 230 }), // same title, wrong artist
      makeSong('good_1', 'Clocks', 'Coldplay', { durationSec: 307 }),
      makeSong('good_2', 'Starlight', 'Muse', { durationSec: 240 }),
    ];

    const filtered = filterMusicRadioTracks(candidates, seed);
    assert.deepEqual(
      filtered.map((s) => s.videoId),
      ['good_1', 'good_2']
    );
  });

  test('InnerTubeParser.parseUpNextRadio parses durationSeconds and filters podcasts', () => {
    const parser = new InnerTubeParser();
    const raw = {
      contents: {
        singleColumnMusicWatchNextResultsRenderer: {
          tabbedRenderer: {
            watchNextTabbedResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      musicQueueRenderer: {
                        content: {
                          playlistPanelRenderer: {
                            contents: [
                              {
                                playlistPanelVideoRenderer: {
                                  videoId: 'v_ok',
                                  title: { runs: [{ text: 'Midnight City' }] },
                                  longBylineText: {
                                    runs: [
                                      { text: 'M83', navigationEndpoint: { browseEndpoint: { browseId: 'UC1' } } },
                                      { text: ' • ' },
                                      { text: 'Hurry Up' },
                                      { text: ' • ' },
                                      { text: '4:04' },
                                    ],
                                  },
                                  lengthText: { runs: [{ text: '4:04' }] },
                                },
                              },
                              {
                                playlistPanelVideoRenderer: {
                                  videoId: 'v_pod',
                                  title: { runs: [{ text: 'Deep Tech Podcast' }] },
                                  longBylineText: { runs: [{ text: 'Podcast • 55:10' }] },
                                  lengthText: { runs: [{ text: '55:10' }] },
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    };

    const parsed = parser.parseUpNextRadio(raw);
    assert.equal(parsed.length, 2);
    const vOk = parsed.find((t) => t.videoId === 'v_ok');
    assert.equal(vOk?.durationSec, 244);
    const filtered = filterMusicRadioTracks(parsed, makeSong('seed_0', 'Other', 'Artist'));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].videoId, 'v_ok');
  });

  test('queueStore isolates USER_QUEUE from AUTOPLAY and supports move, reorder, and removal', () => {
    const store = useQueueStore.getState();
    const s1 = makeSong('s1', 'Track 1', 'Artist A');
    const a1 = makeSong('a1', 'Auto 1', 'Artist B');
    const a2 = makeSong('a2', 'Auto 2', 'Artist C');
    const u1 = makeSong('u1', 'User Next', 'Artist D');

    store.playNext(u1);
    store.setAutoplayQueue([a1, a2]);
    assert.equal(useQueueStore.getState().tiers.USER_QUEUE.length, 1);
    assert.equal(useQueueStore.getState().tiers.AUTOPLAY.length, 2);

    // Move track down & remove inside AUTOPLAY / USER_QUEUE
    store.reorderQueue('AUTOPLAY', 0, 1);
    assert.deepEqual(
      useQueueStore.getState().tiers.AUTOPLAY.map((s) => s.videoId),
      ['a2', 'a1']
    );

    store.removeFromQueue('USER_QUEUE', 0);
    assert.equal(useQueueStore.getState().tiers.USER_QUEUE.length, 0);

    store.setCurrentSong(s1);
    assert.equal(useQueueStore.getState().currentSong?.videoId, 's1');
  });
});
