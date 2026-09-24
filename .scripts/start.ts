/** A start script for serving the project with live reload. */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import {
  loadBlueprint,
  readSectionHtml,
  resolveContentFile,
  siblingCssUnderSrc,
} from './tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const PORT = Number(process.env.PORT) || 4321;
const HOST = '127.0.0.1';
const INDEX_FILE = 'index.html';
const SECTIONS_MARKER = '<!-- sections -->';
const STYLESHEETS_MARKER = '<!-- stylesheets -->';
const INCLUDE_RE = /<!--\s*include:([\w.-]+)\s*-->/g;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

type SseClient = http.ServerResponse;
const clients = new Set<SseClient>();

const LIVERELOAD_SCRIPT = `
<script>
(function () {
  var es = new EventSource("/__livereload");
  es.onmessage = function () { location.reload(); };
  es.onerror = function () { /* browser reconnects */ };
})();
</script>
`;

function openBrowser(url: string): void {
  const p = platform();
  const cmd =
    p === 'win32'
      ? `cmd /c start "" "${url}"`
      : p === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.warn('start: could not open browser:', err.message);
  });
}

function safeJoin(base: string, reqPath: string): string | null {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/');
  const cleaned = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(base, cleaned || '.');
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

function expandIncludes(template: string): string {
  return template.replace(INCLUDE_RE, (_match, filename: string) => {
    const filePath = path.join(srcDir, filename);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error('missing include: src/' + filename);
    }
    return fs.readFileSync(filePath, 'utf8');
  });
}

function buildSectionsHtml(): string {
  const blueprint = loadBlueprint(root);
  const chunks: string[] = [];

  for (const section of blueprint.sections) {
    const html = readSectionHtml(root, section);
    const title = section.title.trim();
    if (title) {
      chunks.push('<h2>' + escapeHtml(title) + '</h2>\n' + html);
    } else {
      chunks.push(html);
    }
  }

  return chunks.join('\n\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildStylesheetLinks(): string {
  const blueprint = loadBlueprint(root);
  const links: string[] = [];
  const seen = new Set<string>();

  for (const section of blueprint.sections) {
    const abs = resolveContentFile(root, section.content);
    const css = siblingCssUnderSrc(root, srcDir, abs);
    if (!css || seen.has(css.url)) continue;
    seen.add(css.url);
    links.push('  <link rel="stylesheet" href="' + css.url + '" />');
  }

  return links.join('\n');
}

function injectLivereload(html: string): string {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, LIVERELOAD_SCRIPT + '</body>');
  }
  return html + LIVERELOAD_SCRIPT;
}

function renderIndex(): string {
  const indexPath = path.join(srcDir, INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    throw new Error('src/index.html not found');
  }

  let template = fs.readFileSync(indexPath, 'utf8');
  template = expandIncludes(template);

  if (!template.includes(STYLESHEETS_MARKER)) {
    throw new Error(
      'src/index.html missing ' + STYLESHEETS_MARKER + ' after includes',
    );
  }
  if (!template.includes(SECTIONS_MARKER)) {
    throw new Error(
      'profile template missing ' +
        SECTIONS_MARKER +
        ' (expected inside #user-profile-frame)',
    );
  }

  template = template.replace(STYLESHEETS_MARKER, buildStylesheetLinks());
  template = template.replace(SECTIONS_MARKER, buildSectionsHtml());
  return injectLivereload(template);
}

function notifyReload(): void {
  for (const res of clients) {
    try {
      res.write('data: reload\n\n');
    } catch {
      clients.delete(res);
    }
  }
}

function watchPath(target: string, label: string, recursive: boolean): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bump = (detail: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('start: change detected ->', detail);
      notifyReload();
    }, 80);
  };

  if (!fs.existsSync(target)) {
    console.warn('start: watch skip (missing)', label);
    return;
  }

  try {
    fs.watch(target, { recursive }, (_event, filename) => {
      bump(filename ? label + '/' + String(filename) : label);
    });
    console.log('start: watching', label);
  } catch (err) {
    console.warn('start: watch failed for', label, err);
  }
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/__livereload')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const wantIndex =
    url === '/' ||
    url.startsWith('/?') ||
    url === '/' + INDEX_FILE ||
    url.startsWith('/' + INDEX_FILE + '?');

  if (wantIndex) {
    try {
      const page = renderIndex();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('start:', message);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('start error: ' + message);
    }
    return;
  }

  const filePath = safeJoin(srcDir, url);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let target = filePath;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }

  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log('start: serving', srcDir);
  console.log('start: open', url);
  watchPath(srcDir, 'src', true);
  watchPath(path.join(root, 'README.json'), 'README.json', false);
  openBrowser(url);
});
