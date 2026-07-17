import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'astro:content': fileURLToPath(
        new URL('./tests/stubs/astro-content.ts', import.meta.url),
      ),
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url),
      ),
      // Mirror the tsconfig path aliases so tested code can follow the repo's
      // own import convention (@lib/…) instead of being pinned to relative paths.
      '@components': `${srcDir}/components`,
      '@lib': `${srcDir}/lib`,
      '@styles': `${srcDir}/styles`,
      '@layouts': `${srcDir}/layouts`,
      '@': srcDir,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
