// tests/verify_fonts.mjs
// Empirical verification of @font-face typography definitions in src/index.css and dist/assets/

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const cssPath = path.resolve('src/index.css');
const cssContent = fs.readFileSync(cssPath, 'utf-8');

// Match @font-face blocks
const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;
let match;
const faces = [];

while ((match = fontFaceRegex.exec(cssContent)) !== null) {
  const block = match[1];
  const familyMatch = block.match(/font-family:\s*['"]([^'"]+)['"]/);
  const srcMatch = block.match(/src:\s*url\(['"]?([^'")]+)['"]?\)/);
  const weightMatch = block.match(/font-weight:\s*(\d+)/);
  if (familyMatch && srcMatch && weightMatch) {
    faces.push({
      family: familyMatch[1].trim(),
      src: srcMatch[1].trim(),
      weight: parseInt(weightMatch[1], 10),
    });
  }
}

console.log('--- Parsed @font-face rules from src/index.css ---');
console.table(faces);

const expectedWeights = [
  { weight: 400, expectedFile: 'sf_pro_display_regular.otf', label: 'Regular' },
  { weight: 500, expectedFile: 'sf_pro_display_medium.otf', label: 'Medium' },
  { weight: 600, expectedFile: 'sf_pro_display_semibold.otf', label: 'Semibold' },
  { weight: 700, expectedFile: 'sf_pro_display_bold.otf', label: 'Bold' },
  { weight: 800, expectedFile: 'sf_pro_display_heavy.otf', label: 'Heavy (800)' },
  { weight: 900, expectedFile: 'sf_pro_display_heavy.otf', label: 'Heavy (900)' },
];

const sfPro = faces.filter((f) => f.family === 'SF Pro Display');
assert.strictEqual(sfPro.length, 6, `Expected 6 SF Pro Display @font-face declarations, found ${sfPro.length}`);

for (const exp of expectedWeights) {
  const found = sfPro.find((f) => f.weight === exp.weight);
  assert.ok(found, `Missing @font-face for weight ${exp.weight} (${exp.label})`);
  assert.ok(
    found.src.includes(exp.expectedFile),
    `Weight ${exp.weight} (${exp.label}) expected ${exp.expectedFile}, but found ${found.src}`
  );
  console.log(`[PASS] Weight ${exp.weight} (${exp.label}) correctly maps to ${exp.expectedFile}`);
}

// Verify Vazirmatn font
const vazir = faces.find((f) => f.family === 'Vazirmatn');
assert.ok(vazir, 'Missing Vazirmatn @font-face');
assert.strictEqual(vazir.weight, 400);
assert.ok(vazir.src.includes('vazirmatn_regular.ttf'));
console.log('[PASS] Vazirmatn 400 correctly maps to vazirmatn_regular.ttf');

// Verify dist bundled CSS
const distAssetsDir = path.resolve('dist/assets');
const distFiles = fs.readdirSync(distAssetsDir);
const distCss = distFiles.find((f) => f.startsWith('index-') && f.endsWith('.css'));
assert.ok(distCss, 'Compiled dist CSS file not found');

const distCssContent = fs.readFileSync(path.join(distAssetsDir, distCss), 'utf-8');
console.log(`\n--- Verifying Compiled Bundle: dist/assets/${distCss} ---`);

for (const exp of expectedWeights) {
  const baseName = exp.expectedFile.replace('.otf', '');
  assert.ok(
    distCssContent.includes(baseName),
    `Compiled bundle does not contain reference to ${baseName}`
  );
  console.log(`[PASS] Compiled CSS bundle includes hashed asset for ${baseName}`);
}

console.log('\n[ALL PASS] Objective 2 Typography Font-Face Weights Empirically Verified!');
