import { createServer } from 'vite';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 1. Ensure Electron main & preload are compiled
console.log('[WaveForm Dev] Compiling Electron main and preload scripts...');
execSync('npm run electron:compile', {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
});

// 2. Start Vite dev server programmatically
console.log('[WaveForm Dev] Initializing Vite dev server...');
const server = await createServer({
  configFile: path.resolve(projectRoot, 'vite.config.ts'),
  root: projectRoot,
  server: {
    port: 5173,
    strictPort: true,
  },
});

await server.listen();
const localUrl = server.resolvedUrls?.local?.[0] || 'http://localhost:5173/';
console.log(`[WaveForm Dev] Vite dev server ready at: ${localUrl}`);

// 3. Spawn Electron with guaranteed active server
console.log('[WaveForm Dev] Launching Electron desktop window...');
const electronProcess = spawn(electronPath, ['.'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: localUrl,
  },
});

let isShuttingDown = false;

const cleanShutdown = async (exitCode = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (electronProcess && !electronProcess.killed) {
    try {
      electronProcess.kill();
    } catch {
      // Ignore
    }
  }
  try {
    await server.close();
  } catch {
    // Ignore
  }
  process.exit(exitCode);
};

electronProcess.on('close', async (code) => {
  console.log(`[WaveForm Dev] Electron process exited (${code}). Terminating Vite server...`);
  await cleanShutdown(code ?? 0);
});

process.on('SIGINT', () => cleanShutdown(0));
process.on('SIGTERM', () => cleanShutdown(0));
