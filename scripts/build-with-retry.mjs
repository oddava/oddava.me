import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  acquireBuildLock,
  prepareBuildEnvironment,
  projectRoot,
  releaseBuildLock,
  sleep,
} from './build-utils.mjs';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

async function runBuild() {
  const nodeOptions = ['--dns-result-order=ipv4first', process.env.NODE_OPTIONS]
    .filter(Boolean)
    .join(' ');

  execSync('pnpm exec astro build --mode production', {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
    },
  });
}

async function main() {
  acquireBuildLock();

  try {
    await prepareBuildEnvironment();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          console.info(`[build] Retry ${attempt}/${MAX_ATTEMPTS}...`);
        }

        await runBuild();
        return;
      } catch {
        if (attempt === MAX_ATTEMPTS) {
          console.error('[build] All attempts failed.');
          process.exitCode = 1;
          return;
        }

        console.warn(
          `[build] Attempt ${attempt} failed (prerender race or busy port). Retrying in ${RETRY_DELAY_MS / 1000}s...`,
        );

        rmSync(join(projectRoot, 'dist'), { recursive: true, force: true });
        await sleep(RETRY_DELAY_MS);
        await prepareBuildEnvironment();
      }
    }
  } finally {
    releaseBuildLock();
  }
}

await main();
