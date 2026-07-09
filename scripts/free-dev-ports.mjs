// Frees Astro + local Redis/content proxy ports left by stale node processes.
// Used by `pnpm dev` so a previous crash or abandoned session does not block
// proxies (45555/45556) or force Astro onto another port.
import { freeDevPorts } from './build-utils.mjs';

const freed = await freeDevPorts();
if (!freed) {
  console.info('[dev-ports] Dev ports are free');
}
