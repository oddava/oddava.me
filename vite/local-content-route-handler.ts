import { createLocalContentProvider } from '../src/lib/server/content/local-provider';
import { dispatchContentRequest } from '../src/lib/server/content/router';

export function createLocalContentRouteHandler(projectRoot: string) {
  const provider = createLocalContentProvider(projectRoot);
  let mutationQueue: Promise<void> = Promise.resolve();

  function runMutation(operation: () => Promise<Response>): Promise<Response> {
    const pending = mutationQueue.then(operation);
    mutationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  return async (request: Request): Promise<Response> => {
    // A mutation often spans several provider calls (read, validate, write,
    // re-read). Serialize the complete request so two writes cannot validate
    // against the same snapshot and reads never observe a half-finished move.
    return runMutation(() =>
      Promise.resolve(dispatchContentRequest(provider, request)),
    );
  };
}
