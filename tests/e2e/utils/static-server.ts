#!/usr/bin/env bun
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

// The app is a static SPA (`ssr: false`, nitro `static`), so e2e serves dist/
// directly. Anything that is not a real file falls through to index.html, which
// is what makes client-side routes like /tabs/today resolvable on a cold load.

const ROOT = join(import.meta.dir, '../../../dist');
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.woff': 'font/woff',
	'.wasm': 'application/wasm',
	'.map': 'application/json; charset=utf-8'
};

if (!existsSync(ROOT)) {
	console.error(`[static-server] ${ROOT} does not exist; run \`bun run build:test\` first`);
	process.exit(1);
}

function resolve(pathname: string): string | null {
	// normalize first so a traversal cannot escape dist/
	const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
	const candidate = join(ROOT, safe);
	if (!candidate.startsWith(ROOT)) return null;

	if (existsSync(candidate)) {
		if (statSync(candidate).isDirectory()) {
			const index = join(candidate, 'index.html');
			return existsSync(index) ? index : null;
		}
		return candidate;
	}

	// a prerendered route directory, e.g. /tabs/today -> tabs/today/index.html
	const nested = join(candidate, 'index.html');
	if (existsSync(nested)) return nested;

	const html = `${candidate}.html`;
	return existsSync(html) ? html : null;
}

const server = Bun.serve({
	port: PORT,
	hostname: HOST,
	fetch(request) {
		const { pathname } = new URL(request.url);
		const file = resolve(pathname) ?? join(ROOT, 'index.html');

		if (!existsSync(file)) return new Response('Not Found', { status: 404 });

		return new Response(Bun.file(file), {
			headers: {
				'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
				// never cache in e2e; a stale bundle silently tests the old build
				'Cache-Control': 'no-store'
			}
		});
	}
});

console.log(`[static-server] serving ${ROOT} on http://${HOST}:${server.port}`);
