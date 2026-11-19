// tests/fixtures/mockAutoEq.mjs
// Headphone AutoEQ database entries & 16 factory Equalizer curves conforming to Survey 2 & 3

export const mockAutoEq = {
  headphoneProfiles: [
    {
      id: 'sony_wh1000xm4',
      name: 'Sony WH-1000XM4',
      type: 'Over-Ear',
      source: 'Oratory1990',
      preampGainDb: -5.6,
      filters: [
        { type: 'LOW_SHELF', freq: 105, q: 0.71, gainDb: -4.5 },
        { type: 'PEAKING', freq: 210, q: 1.4, gainDb: 2.8 },
        { type: 'PEAKING', freq: 1100, q: 2.1, gainDb: -3.2 },
        { type: 'PEAKING', freq: 3200, q: 3.0, gainDb: 4.5 },
        { type: 'PEAKING', freq: 6400, q: 2.5, gainDb: -2.0 },
        { type: 'HIGH_SHELF', freq: 10000, q: 0.71, gainDb: -1.5 },
      ],
    },
    {
      id: 'sennheiser_hd600',
      name: 'Sennheiser HD 600',
      type: 'Open-Back Over-Ear',
      source: 'Crinacle',
      preampGainDb: -6.2,
      filters: [
        { type: 'LOW_SHELF', freq: 80, q: 0.71, gainDb: 5.5 },
        { type: 'PEAKING', freq: 200, q: 1.2, gainDb: -1.0 },
        { type: 'PEAKING', freq: 3500, q: 2.5, gainDb: -2.5 },
        { type: 'PEAKING', freq: 5800, q: 4.0, gainDb: 2.0 },
        { type: 'HIGH_SHELF', freq: 12000, q: 0.71, gainDb: 1.0 },
      ],
    },
    {
      id: 'apple_airpods_max',
      name: 'Apple AirPods Max',
      type: 'Over-Ear ANC',
      source: 'Rtings',
      preampGainDb: -3.8,
      filters: [
        { type: 'LOW_SHELF', freq: 90, q: 0.71, gainDb: -2.0 },
        { type: 'PEAKING', freq: 1250, q: 1.8, gainDb: 1.5 },
        { type: 'PEAKING', freq: 4100, q: 2.8, gainDb: -3.0 },
        { type: 'HIGH_SHELF', freq: 8500, q: 0.71, gainDb: 2.2 },
      ],
    },
  ],

  // 10 EQ Bands in Hz: [60, 170, 310, 600, 1000, 3000, 6000, 10000, 12000, 14000]
  bandsHz: [60, 170, 310, 600, 1000, 3000, 6000, 10000, 12000, 14000],

  // 16 Factory EQ Presets mapped to 10 bands gains in dB
  factoryPresets: {
    Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    Acoustic: [3.5, 3.0, 2.0, 1.0, 1.5, 2.0, 3.0, 3.5, 3.0, 2.5],
    BassBoost: [7.0, 5.5, 4.0, 2.0, 0.5, 0, 0, 0, 0, 0],
    BassReducer: [-6.0, -4.5, -3.0, -1.5, 0, 0, 0, 0, 0, 0],
    Classical: [4.0, 3.0, 2.0, 2.0, -1.0, -1.0, 0, 2.0, 3.0, 3.5],
    Dance: [5.0, 6.0, 2.0, 0, 2.0, 3.5, 4.5, 4.0, 3.0, 0],
    Deep: [4.5, 3.5, 1.5, 2.0, 2.5, 1.0, 0, -2.0, -3.0, -4.0],
    Electronic: [4.5, 4.0, 1.0, 0, -1.5, 2.0, 1.0, 2.5, 4.0, 4.5],
    HipHop: [5.5, 4.5, 1.5, 2.0, -1.0, -1.0, 1.5, -1.0, 2.0, 2.5],
    Jazz: [3.5, 2.5, 1.0, 1.5, -1.5, -1.5, 0, 1.5, 3.0, 3.5],
    Latin: [3.0, 2.0, 0, 0, -1.0, -1.0, -1.0, 1.0, 3.0, 4.0],
    Loudness: [6.0, 4.5, 0, -1.5, -2.0, -1.0, -2.5, -4.0, 5.0, 6.0],
    Lounge: [-2.0, -1.0, 0, 1.5, 3.0, 2.0, 0, -1.5, 2.0, 1.0],
    Piano: [2.5, 1.5, 0, 2.0, 2.5, 1.5, 2.5, 3.0, 2.5, 2.0],
    Pop: [-1.5, -1.0, 0, 2.0, 4.0, 3.5, 1.5, -1.0, -1.5, -2.0],
    Rock: [4.5, 3.5, -1.0, -2.5, -1.0, 2.5, 4.0, 5.0, 4.5, 4.0],
  },
};
