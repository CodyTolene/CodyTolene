/** Utility functions for handling README JSON blueprint and other items. */

import fs from 'node:fs';
import path from 'node:path';

type Section = {
  title: string;
  content: string;
};

type ReadmeBlueprint = {
  sections: Section[];
};

const SAFE_CONTENT_PATH = /^(?!\.\.\/)(?!.*\/\.\.\/)[A-Za-z0-9._/-]+$/;

function stripLocalCss(html: string): string {
  return html
    .replace(/<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

export function loadBlueprint(root: string): ReadmeBlueprint {
  const jsonPath = path.join(root, 'README.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error('README.json not found at repo root');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error('README.json is not valid JSON: ' + message);
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('README.json: root must be an object');
  }

  const sections = (raw as { sections?: unknown }).sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('README.json: sections must be a non-empty array');
  }

  const normalized: Section[] = [];
  for (let i = 0; i < sections.length; i++) {
    const item = sections[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('README.json: sections[' + i + '] must be an object');
    }
    const title = (item as { title?: unknown }).title;
    const content = (item as { content?: unknown }).content;
    if (typeof title !== 'string') {
      throw new Error(
        'README.json: sections[' + i + '].title must be a string',
      );
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(
        'README.json: sections[' + i + '].content must be a non-empty string',
      );
    }
    if (!SAFE_CONTENT_PATH.test(content)) {
      throw new Error(
        'README.json: sections[' +
          i +
          '].content is not a safe relative path: ' +
          content,
      );
    }
    normalized.push({ title, content });
  }

  return { sections: normalized };
}

export function resolveContentFile(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error('content path escapes repo root: ' + rel);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error('content file missing: ' + rel);
  }
  return resolved;
}

export function siblingCssUnderSrc(
  root: string,
  srcDir: string,
  contentAbs: string,
): { abs: string; url: string } | null {
  const cssAbs = contentAbs.replace(/\.html?$/i, '.css');
  if (cssAbs === contentAbs) return null;
  if (!fs.existsSync(cssAbs) || !fs.statSync(cssAbs).isFile()) return null;

  const srcWithSep = srcDir.endsWith(path.sep) ? srcDir : srcDir + path.sep;
  if (!cssAbs.startsWith(srcWithSep) && cssAbs !== srcDir) return null;

  const relFromSrc = path.relative(srcDir, cssAbs).split(path.sep).join('/');
  return { abs: cssAbs, url: '/' + relFromSrc };
}

export function readSectionHtml(root: string, section: Section): string {
  const abs = resolveContentFile(root, section.content);
  return stripLocalCss(fs.readFileSync(abs, 'utf8')).trimEnd();
}
