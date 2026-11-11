import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const clientRoot = path.join(projectRoot, 'dist', 'client');
const serverEntryPath = path.join(projectRoot, 'dist', 'server', 'entry.mjs');

async function collectHtmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(filePath)));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(filePath);
    }
  }
  return files;
}

const sha256 = (source) =>
  `'sha256-${createHash('sha256').update(source).digest('base64')}'`;

/**
 * Every inline script the browser would run, and every inline style element,
 * must be covered by its exact hash in the page's own CSP. JSON-LD and other
 * data blocks are not executed, so they need none. Portfolio pages must also
 * carry the appearance pre-paint: it is the one inline script they add.
 */
function inlineHashFailures(html, relativePath) {
  const failures = [];
  const policy =
    /<meta\s+http-equiv=["']content-security-policy["']\s+content=(["'])([\s\S]*?)\1/i.exec(
      html,
    )?.[2] ?? '';
  const executable = (attributes) => {
    const type = /\btype=["']?([^"'\s>]+)/i.exec(attributes)?.[1];
    return (
      !type ||
      /^(?:module|text\/javascript|application\/javascript)$/i.test(type)
    );
  };
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    const [, attributes, body] = match;
    if (/\bsrc=/i.test(attributes) || !executable(attributes) || !body)
      continue;
    if (!policy.includes(sha256(body))) {
      failures.push(`${relativePath}: inline script not covered by a CSP hash`);
    }
  }
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (match[1] && !policy.includes(sha256(match[1]))) {
      failures.push(`${relativePath}: inline style not covered by a CSP hash`);
    }
  }
  if (/<html\b[^>]*\bdata-site=["']portfolio["']/i.test(html)) {
    const prepaints = [
      ...html.matchAll(
        /<script\b[^>]*\bdata-appearance-prepaint\b[^>]*>([\s\S]*?)<\/script>/gi,
      ),
    ];
    if (prepaints.length !== 1 || !prepaints[0][1]) {
      failures.push(
        `${relativePath}: portfolio page lacks the appearance pre-paint`,
      );
    }
  }
  return failures;
}

const htmlFiles = await collectHtmlFiles(clientRoot);
if (htmlFiles.length === 0) {
  throw new Error('Build verification found no prerendered HTML files.');
}

const failures = [];
for (const filePath of htmlFiles) {
  const html = await readFile(filePath, 'utf8');
  const relativePath = path.relative(projectRoot, filePath);
  const isRedirect = /<meta\s+http-equiv=["']refresh["']/i.test(html);

  if (
    !isRedirect &&
    !/http-equiv=["']content-security-policy["']/i.test(html)
  ) {
    failures.push(`${relativePath}: missing Astro CSP meta policy`);
  }
  if (!isRedirect && !/sha256-[a-z0-9+/]+=*/i.test(html)) {
    failures.push(`${relativePath}: CSP does not contain generated hashes`);
  }
  if (/unsafe-inline/i.test(html)) {
    failures.push(`${relativePath}: CSP contains unsafe-inline`);
  }
  if (/\sstyle\s*=/i.test(html)) {
    failures.push(`${relativePath}: contains a blocked inline style attribute`);
  }
  const canonical = /<link rel="canonical" href="([^"]+)"/i.exec(html)?.[1];
  if (canonical && /\.html$/i.test(canonical)) {
    failures.push(`${relativePath}: canonical names the .html file`);
  }
  if (isRedirect && /<(?:script|style)\b/i.test(html)) {
    failures.push(`${relativePath}: redirect contains executable content`);
  }
  if (!isRedirect) {
    failures.push(...inlineHashFailures(html, relativePath));
  }
}

// The pre-paint check above only bites on portfolio pages, so name the
// prerendered ones: if either stops being one, the check would pass empty.
for (const name of ['index.html', 'about.html']) {
  const html = await readFile(path.join(clientRoot, name), 'utf8').catch(
    () => '',
  );
  if (!/<html\b[^>]*\bdata-site=["']portfolio["']/i.test(html)) {
    failures.push(`dist/client/${name}: not a prerendered portfolio page`);
  }
}

const staticHeaders = await readFile(path.join(clientRoot, '_headers'), 'utf8');
if (
  !staticHeaders.includes("Content-Security-Policy: frame-ancestors 'none'")
) {
  failures.push('dist/client/_headers: missing static frame policy');
}

const serverEntry = await readFile(serverEntryPath, 'utf8');
if (
  !serverEntry.includes('"route": "/notes/graph"') ||
  !serverEntry.includes('"component": "src/pages/notes/graph.astro"')
) {
  failures.push('dist/server/entry.mjs: missing the /notes/graph SSR route');
}

// The deployed config is the one the adapter generates, not wrangler.jsonc.
// Without these, the notes host would get apex pages from the asset store
// (see src/worker.ts and tests/notes-host-assets.test.ts).
const deployedConfig = JSON.parse(
  await readFile(
    path.join(projectRoot, 'dist', 'server', 'wrangler.json'),
    'utf8',
  ),
);
const workerFirst = deployedConfig.assets?.run_worker_first;
if (!Array.isArray(workerFirst) || !workerFirst.includes('/')) {
  failures.push(
    'dist/server/wrangler.json: assets.run_worker_first does not cover /',
  );
}
const serverChunks = await readdir(path.join(projectRoot, 'dist', 'server'), {
  recursive: true,
});
let hasNotesHostEntry = false;
for (const chunk of serverChunks) {
  if (!chunk.endsWith('.mjs')) continue;
  const code = await readFile(
    path.join(projectRoot, 'dist', 'server', chunk),
    'utf8',
  );
  if (code.includes('notes.localhost')) {
    hasNotesHostEntry = true;
    break;
  }
}
if (!hasNotesHostEntry) {
  failures.push('dist/server: the notes-host Worker entry is not bundled');
}

if (failures.length > 0) {
  throw new Error(
    `Build security verification failed:\n${failures.join('\n')}`,
  );
}

console.info(
  `[build] Verified strict CSP output for ${htmlFiles.length} prerendered pages, the /notes/graph SSR route, and the notes-host Worker entry.`,
);
