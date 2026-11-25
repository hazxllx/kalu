import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { DEFAULT_MAP_STYLE_URL, PUBLIC_MAP_ORIGIN, validateLocalEnvironment } from '../src/lib/localSafety.js';

export function loadLocalEnvironment(mode, directory, inherited = process.env) {
  if (!/^[a-zA-Z0-9_-]+$/.test(mode) || mode === 'production' || mode === 'local') {
    throw new Error('Use a non-production Vite mode for local development.');
  }
  if (Object.keys(inherited).some((name) => name.startsWith('VITE_'))) {
    throw new Error('Local VITE_ configuration must come exclusively from .env; remove inherited VITE_ variables.');
  }
  const env = {};
  const parsedEnvironment = {};
  const path = resolve(directory, '.env');
  if (existsSync(path)) {
    // Literal values only: no expansion from the file or the shell.
    const parsed = parseEnv(readFileSync(path, 'utf8'));
    Object.assign(parsedEnvironment, parsed);
    for (const [name, value] of Object.entries(parsed)) {
      if (name.startsWith('VITE_')) env[name] = value;
    }
  }
  // Accept the public backend-style aliases used by the shared environment
  // files, while exposing only VITE_* values to the browser bundle.
  env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL?.trim()
    || String(parsedEnvironment.SUPABASE_URL || '').trim();
  env.VITE_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY?.trim()
    || String(parsedEnvironment.SUPABASE_ANON_KEY || '').trim();
  validateLocalEnvironment(env);
  return env;
}

export function localContentSecurityPolicy(env) {
  validateLocalEnvironment(env);
  const app = new URL(env.VITE_APP_BASE_URL);
  const mapOrigin = new URL(env.VITE_MAP_STYLE_URL || DEFAULT_MAP_STYLE_URL).origin;
  const origins = [...new Set([
    app.origin,
    new URL(env.VITE_API_URL).origin,
    ...(env.VITE_SUPABASE_URL ? [new URL(env.VITE_SUPABASE_URL).origin] : []),
    ...(mapOrigin !== PUBLIC_MAP_ORIGIN ? [mapOrigin] : []),
  ])];
  const sockets = origins.map((origin) => origin.replace(/^http/, 'ws'));
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // Vite React refresh and the existing theme bootstrap.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `connect-src 'self' ${origins.join(' ')} ${sockets.join(' ')} ${PUBLIC_MAP_ORIGIN}`,
    `img-src 'self' data: blob: ${origins.join(' ')} ${PUBLIC_MAP_ORIGIN}`,
    `font-src 'self' data: https://fonts.gstatic.com ${PUBLIC_MAP_ORIGIN}`,
    "worker-src 'self' blob:",
    `frame-src 'self' blob: ${origins.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${origins.join(' ')}`,
    "frame-ancestors 'self'",
  ].join('; ');
}

export function localIsolationPlugin(env) {
  const policy = localContentSecurityPolicy(env);
  const origin = new URL(env.VITE_APP_BASE_URL).origin;
  return {
    name: 'local-development-isolation',
    config(config) {
      // Vite normalizes an absolute base to a pathname during development.
      const base = config.base || '/';
      if (/^[a-z]+:/i.test(base) || base.startsWith('//')) {
        throw new Error('Local Vite requires a relative asset base.');
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // Reject non-loopback Host headers, including access through a tunnel.
        try {
          const host = new URL(`http://${request.headers.host}`);
          if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) throw new Error();
        } catch {
          response.writeHead(403).end('Local development requires a loopback host.');
          return;
        }
        response.setHeader('Content-Security-Policy', policy);
        response.setHeader('Referrer-Policy', 'no-referrer');
        next();
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy.replace("; frame-ancestors 'self'", '') }, injectTo: 'head-prepend' }];
      },
    },
    configResolved(config) {
      const app = new URL(origin);
      if (config.server.host !== app.hostname.replace(/^\[|\]$/g, '') || !config.server.strictPort) {
        throw new Error('Local Vite must bind the configured loopback host with strictPort enabled.');
      }
      if (config.server.origin && config.server.origin !== origin) {
        throw new Error('Local Vite must use the configured frontend origin.');
      }
      if (config.server.proxy || config.preview.proxy) {
        throw new Error('Proxies are not permitted in local frontend isolation.');
      }
      if (config.server.hmr && typeof config.server.hmr === 'object') {
        const hmr = config.server.hmr;
        if ((hmr.host && hmr.host !== new URL(origin).hostname) || hmr.port || hmr.clientPort) {
          throw new Error('Local HMR must use the configured frontend origin.');
        }
      }
    },
  };
}
