import { acquireBuildLock, prepareBuildEnvironment, releaseBuildLock } from './build-utils.mjs';

const releaseOnly = process.argv.includes('--release');

if (releaseOnly) {
  releaseBuildLock();
  process.exit(0);
}

acquireBuildLock();
await prepareBuildEnvironment();