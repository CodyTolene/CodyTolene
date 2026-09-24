/** A quick build script for generating the README.md from the JSON blueprint. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBlueprint, readSectionHtml } from './tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const readmePath = path.join(root, 'README.md');

function fail(message: string): never {
  console.error('build: ' + message);
  process.exit(1);
}

let blueprint;
try {
  blueprint = loadBlueprint(root);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

const parts: string[] = [];

for (const section of blueprint.sections) {
  let html: string;
  try {
    html = readSectionHtml(root, section);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const title = section.title.trim();
  if (title) {
    parts.push('## ' + title + '\n\n' + html);
  } else {
    parts.push(html);
  }

  console.log(
    'build: section' +
      (title ? ' "' + title + '"' : ' (untitled)') +
      ' <- ' +
      section.content,
  );
}

const output = parts.join('\n\n') + '\n';
fs.writeFileSync(readmePath, output, 'utf8');
console.log(
  'build: wrote README.md (' + parts.length + ' sections, CSS excluded)',
);
