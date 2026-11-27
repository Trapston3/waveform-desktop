// tests/helpers/tsxLoader.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.tsx') || (specifier.startsWith('.') && !specifier.endsWith('.js') && !specifier.endsWith('.ts') && !specifier.endsWith('.mjs'))) {
    try {
      return await nextResolve(specifier.endsWith('.tsx') ? specifier : specifier + '.tsx', context);
    } catch {}
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {}
    try {
      return await nextResolve(specifier + '/index.ts', context);
    } catch {}
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = esbuild.transformSync(source, {
      loader: 'tsx',
      format: 'esm',
      jsx: 'automatic',
    });
    return {
      format: 'module',
      source: transpiled.code,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
