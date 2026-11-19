import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { Readable } from 'node:stream';

function rewriteRangeHeader(
  rawRange: string | undefined | null,
  knownContentLength?: number | null,
  maxChunkSize = 256 * 1024
): string | undefined {
  if (!rawRange) {
    const end = knownContentLength && knownContentLength > 0
      ? Math.min(maxChunkSize - 1, knownContentLength - 1)
      : maxChunkSize - 1;
    return `bytes=0-${end}`;
  }

  if (typeof rawRange !== 'string') return rawRange;
  const trimmed = rawRange.trim();
  const match = trimmed.match(/^bytes\s*=\s*(.+)$/i);
  if (!match) return rawRange;

  const singleSpec = match[1].trim().split(',')[0].trim();

  // 1. Suffix range: "-SUFFIX" (e.g. "-500")
  const suffixMatch = singleSpec.match(/^-\s*(\d+)$/);
  if (suffixMatch) {
    const suffixLen = parseInt(suffixMatch[1], 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return rawRange;
    if (knownContentLength && knownContentLength > 0) {
      const clampedSuffix = Math.min(suffixLen, maxChunkSize);
      const start = Math.max(0, knownContentLength - clampedSuffix);
      const end = Math.min(knownContentLength - 1, start + maxChunkSize - 1);
      return `bytes=${start}-${end}`;
    }
    return `bytes=-${Math.min(suffixLen, maxChunkSize)}`;
  }

  // 2. Standard range: "START-[END]"
  const standardMatch = singleSpec.match(/^(\d+)\s*-\s*(\d*)$/);
  if (standardMatch) {
    const start = parseInt(standardMatch[1], 10);
    if (!Number.isFinite(start) || start < 0) return rawRange;

    const rawEnd = standardMatch[2] ? parseInt(standardMatch[2], 10) : null;
    const end = rawEnd !== null && Number.isFinite(rawEnd) ? rawEnd : null;

    if (end !== null && end < start) return rawRange;

    let targetEnd = end !== null
      ? Math.min(end, start + maxChunkSize - 1)
      : start + maxChunkSize - 1;

    if (knownContentLength && knownContentLength > 0 && targetEnd >= knownContentLength) {
      targetEnd = knownContentLength - 1;
    }
    if (targetEnd < start) {
      targetEnd = start;
    }
    return `bytes=${start}-${targetEnd}`;
  }

  // 3. Malformed/non-numeric: return original safely without NaN
  return rawRange;
}

function waveformNetworkProxyPlugin(): Plugin {
  const attachMiddleware = (middlewares: any) => {
    middlewares.use('/__waveform_proxy', (req: any, res: any, next: any) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        });
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        next();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          const parsed = JSON.parse(rawBody);
          const targetUrl = parsed.url;
          const options = parsed.options || {};

          const upstreamRes = await fetch(targetUrl, {
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body,
          });

          const text = await upstreamRes.text();
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(
            JSON.stringify({
              ok: upstreamRes.ok,
              status: upstreamRes.status,
              statusText: upstreamRes.statusText,
              text,
            })
          );
        } catch (err: any) {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(
            JSON.stringify({
              ok: false,
              status: 500,
              statusText: err?.message || 'Proxy Error',
              text: '',
            })
          );
        }
      });
    });

    middlewares.use('/__waveform_stream', async (req: any, res: any) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        });
        res.end();
        return;
      }

      try {
        const reqUrl = new URL(req.url || '', 'http://localhost');
        const targetUrl = reqUrl.searchParams.get('url');
        if (!targetUrl) {
          res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
          res.end('Missing url param');
          return;
        }

        const headers: Record<string, string> = {};

        if (targetUrl.includes('googlevideo.com')) {
          headers['User-Agent'] =
            'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';
          let clen: number | null = null;
          try {
            const parsedTarget = new URL(targetUrl);
            const clenParam = parsedTarget.searchParams.get('clen');
            if (clenParam) {
              const parsed = parseInt(clenParam, 10);
              if (!isNaN(parsed) && parsed > 0) clen = parsed;
            }
          } catch {
            // Ignore URL parse error
          }

          const rawRange = req.headers.range || req.headers.Range;
          const rewritten = rewriteRangeHeader(rawRange, clen);
          if (rewritten) {
            headers['Range'] = rewritten;
          }
        } else {
          headers['User-Agent'] =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
          if (req.headers.range) {
            headers['Range'] = req.headers.range;
          }
          if (targetUrl.includes('youtube.com')) {
            headers['Origin'] = 'https://www.youtube.com';
            headers['Referer'] = 'https://www.youtube.com/';
          } else if (targetUrl.includes('saavncdn.com') || targetUrl.includes('jiosaavn.com')) {
            headers['Origin'] = 'https://www.jiosaavn.com';
            headers['Referer'] = 'https://www.jiosaavn.com/';
          }
        }

        const upstream = await fetch(targetUrl, {
          method: req.method === 'HEAD' ? 'HEAD' : 'GET',
          headers,
        });

        const outHeaders: Record<string, string> = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
          'Content-Type': upstream.headers.get('content-type') || 'audio/mp4',
          'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
        };
        const contentLength = upstream.headers.get('content-length');
        if (contentLength) outHeaders['Content-Length'] = contentLength;
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) outHeaders['Content-Range'] = contentRange;

        res.writeHead(upstream.status, outHeaders);
        if (req.method === 'HEAD' || !upstream.body) {
          res.end();
          return;
        }

        const nodeStream = Readable.fromWeb(upstream.body as any);
        req.on('close', () => {
          nodeStream.destroy();
        });
        nodeStream.pipe(res);
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
        }
        res.end();
      }
    });
  };

  return {
    name: 'waveform-network-proxy',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), waveformNetworkProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  base: './',
});
