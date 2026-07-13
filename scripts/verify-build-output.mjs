import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const clientRoot = path.join(projectRoot, 'dist', 'client');

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
  if (isRedirect && /<(?:script|style)\b/i.test(html)) {
    failures.push(`${relativePath}: redirect contains executable content`);
  }
}

const staticHeaders = await readFile(path.join(clientRoot, '_headers'), 'utf8');
if (
  !staticHeaders.includes("Content-Security-Policy: frame-ancestors 'none'")
) {
  failures.push('dist/client/_headers: missing static frame policy');
}

if (failures.length > 0) {
  throw new Error(
    `Build security verification failed:\n${failures.join('\n')}`,
  );
}

console.info(
  `[build] Verified strict CSP output for ${htmlFiles.length} prerendered pages.`,
);
