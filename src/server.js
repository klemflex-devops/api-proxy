import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { printBanner } from './banner.js';

function readVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
]);

function warnIfNoApiKey(config) {
  if (config.polzaApiKey) return;
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const open = useColor ? '\x1b[33m' : '';
  const close = useColor ? '\x1b[0m' : '';
  process.stdout.write(
    `${open}\u26A0  No API key configured. Clients must send their own Authorization header.${close}\n`,
  );
}

async function main() {
  const config = await loadConfig();
  warnIfNoApiKey(config);

  const injectPaths = config.injectPaths.map((p) => p.replace(/\/+$/, ''));

  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers.cookie',
          'headers.authorization',
          'headers["x-api-key"]',
          'headers.cookie',
        ],
        censor: '[redacted]',
      },
    },
    bodyLimit: 50 * 1024 * 1024,
  });

  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  function buildUpstreamHeaders(requestHeaders) {
    const headers = {};
    for (const [k, v] of Object.entries(requestHeaders)) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    if (!headers.authorization && config.polzaApiKey) {
      headers.authorization = `Bearer ${config.polzaApiKey}`;
    }
    return headers;
  }

  function shouldInject(subPath) {
    return injectPaths.some(
      (p) => subPath === p || subPath.startsWith(p + '/') || subPath.startsWith(p + '?'),
    );
  }

  function applyInjections(subPath, body, log) {
    if (!body || typeof body !== 'object') return body;
    if (!shouldInject(subPath)) return body;

    const injected = [];
    const skipped = [];
    for (const [key, value] of Object.entries(config.inject ?? {})) {
      if (body[key] === undefined) {
        body[key] = value;
        injected.push(key);
      } else {
        skipped.push(key);
      }
    }
    if (injected.length || skipped.length) {
      log.info({ injected, skippedByClient: skipped, path: subPath }, 'inject');
    }

    return body;
  }

  fastify.all('/*', async (request, reply) => {
    const subPath = request.url.replace(/^\/v1/, '').split('?')[0];
    const query = request.url.includes('?') ? '?' + request.url.split('?')[1] : '';
    const upstreamUrl = config.upstreamBaseUrl + subPath + query;

    const headers = buildUpstreamHeaders(request.headers);

    let body = request.body;
    let serializedBody;

    const methodHasBody = !['GET', 'HEAD'].includes(request.method);
    if (methodHasBody && body !== undefined && body !== null) {
      if (Buffer.isBuffer(body)) {
        serializedBody = body.length > 0 ? body : undefined;
      } else {
        body = applyInjections(subPath, body, request.log);
        serializedBody = typeof body === 'string' ? body : JSON.stringify(body);
        headers['content-type'] = headers['content-type'] ?? 'application/json';
      }
    }

    const debugBodies = ['1', 'true', 'yes'].includes(
      (process.env.DEBUG_BODIES ?? '').trim().toLowerCase(),
    );

    if (debugBodies) {
      const logBody = Buffer.isBuffer(serializedBody)
        ? `[binary ${serializedBody.length} bytes]`
        : serializedBody;
      request.log.info({ upstreamUrl, outgoingBody: logBody }, 'upstream request');
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: serializedBody,
      });
    } catch (err) {
      request.log.error({ err, upstreamUrl }, 'upstream fetch failed');
      return reply.code(502).send({ error: { message: 'Upstream request failed', detail: String(err) } });
    }

    reply.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (HOP_BY_HOP.has(key.toLowerCase())) return;
      reply.header(key, value);
    });

    if (!upstream.body) return reply.send();

    const contentType = upstream.headers.get('content-type') ?? '';
    const isStream = contentType.includes('text/event-stream');

    const isJsonResponse = contentType.includes('application/json');
    if (debugBodies && !isStream && isJsonResponse) {
      const text = await upstream.text();
      try {
        const parsed = JSON.parse(text);
        request.log.info(
          { provider: parsed?.provider, model: parsed?.model, id: parsed?.id, status: upstream.status },
          'upstream response',
        );
      } catch {
        request.log.info({ status: upstream.status, raw: text.slice(0, 500) }, 'upstream response (non-JSON)');
      }
      return reply.send(text);
    }

    if (debugBodies && !isStream && !isJsonResponse) {
      request.log.info(
        { status: upstream.status, contentType },
        'upstream response (binary, body not logged)',
      );
    }

    if (debugBodies && isStream) {
      const nodeStream = Readable.fromWeb(upstream.body);
      let buf = '';
      let logged = false;
      nodeStream.on('data', (chunk) => {
        if (logged) return;
        buf += chunk.toString('utf8');
        if (buf.length > 4000) {
          request.log.info({ streamHead: buf.slice(0, 2000) }, 'upstream stream head');
          logged = true;
        }
      });
      nodeStream.on('end', () => {
        if (!logged && buf.length) {
          request.log.info({ streamHead: buf.slice(0, 2000) }, 'upstream stream head (short)');
        }
      });
      return reply.send(nodeStream);
    }

    return reply.send(Readable.fromWeb(upstream.body));
  });

  fastify.get('/healthz', async () => ({ ok: true }));

  try {
    await fastify.listen({ port: config.port, host: config.host });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      process.stderr.write(
        `\nPort ${config.port} is already in use. Set a different port in config.json ` +
        `(${config.sourcePath}).\n\n`,
      );
      process.exit(1);
    }
    fastify.log.error(err);
    process.exit(1);
  }

  printBanner({
    version: readVersion(),
    host: config.host,
    port: config.port,
    upstream: config.upstreamBaseUrl,
  });
}

main().catch((err) => {
  process.stderr.write(`\n${err?.message ?? err}\n\n`);
  process.exit(1);
});
