import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runFirstRunWizard } from './wizard.js';

export const UPSTREAM_BASE_URL = 'https://polza.ai/api/v1';
export const INJECT_PATHS = ['/chat/completions', '/completions', '/responses'];

function configPath() {
  if (process.env.POLZA_PROXY_CONFIG) {
    return resolve(process.env.POLZA_PROXY_CONFIG);
  }
  return resolve(process.cwd(), 'config.json');
}

function validate(cfg) {
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    throw new Error(`Invalid port ${cfg.port}. Must be an integer between 1 and 65535.`);
  }
}

export async function loadConfig() {
  const path = configPath();

  let raw;
  if (existsSync(path)) {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } else {
    raw = await runFirstRunWizard(path);
  }

  const envKey = process.env.POLZA_API_KEY?.trim();
  const fileKey = typeof raw.polzaApiKey === 'string' ? raw.polzaApiKey.trim() : '';

  const cfg = {
    port: raw.port ?? 8787,
    host: raw.host ?? '127.0.0.1',
    upstreamBaseUrl: UPSTREAM_BASE_URL,
    polzaApiKey: fileKey || envKey || '',
    inject: raw.inject ?? {},
    injectPaths: INJECT_PATHS,
    cacheControl: raw.cacheControl ?? null,
    sourcePath: path,
  };

  validate(cfg);
  return cfg;
}
