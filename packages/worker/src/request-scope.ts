import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApplicationUpstream } from './upstream-adapter';

export type ClientContext = { client: ApplicationUpstream; domain: string };
interface RequestState {
  clients: Map<string, Promise<ClientContext>>;
  preferredClientFlight: Promise<ClientContext> | null;
  domainListFlight: Promise<string[]> | null;
  searchFlights: Map<string, Promise<unknown>>;
}
const storage = new AsyncLocalStorage<RequestState>();
export function requestScope(): RequestState {
  const scope = storage.getStore();
  if (!scope) throw new Error('Upstream work requires a request scope');
  return scope;
}
export function withRequestScope(ctx: ExecutionContext, handler: (ctx: ExecutionContext) => Promise<Response>) {
  const scope: RequestState = { clients: new Map(), preferredClientFlight: null, domainListFlight: null, searchFlights: new Map() };
  const background = new Set<Promise<unknown>>();
  const scopedContext = {
    waitUntil(promise: Promise<unknown>) {
      background.add(promise);
      void promise.finally(() => background.delete(promise)).catch(() => {});
      ctx.waitUntil(promise);
    },
    passThroughOnException: () => ctx.passThroughOnException(),
  } as ExecutionContext;
  return storage.run(scope, async () => {
    try { return await handler(scopedContext); }
    finally {
      // Stale refreshes may still use a client after the response is returned.
      ctx.waitUntil((async () => {
        while (background.size) await Promise.allSettled([...background]);
        for (const result of await Promise.allSettled([...scope.clients.values()]))
          if (result.status === 'fulfilled') result.value.client.dispose();
      })());
    }
  });
}
