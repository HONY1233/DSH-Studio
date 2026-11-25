/**
 * DSH bridge client for the forked DSH Studio renderer.
 *
 * The renderer never talks to the DeepSeek Harness runtime directly: Electron
 * preload exposes a narrow `window.dshStudio` surface, and this module adapts
 * it to the upstream `OmpStudioDesktopApi` shape so the official
 * `StudioClientImpl` + reducer can drive the whole workbench unchanged.
 */

import { StudioClientImpl } from "@omp-studio/client";
import { createDesktopTransport, type OmpStudioDesktopApi } from "@omp-studio/transport-desktop";
import type {
  ClientBootstrap,
  ClientCommandAccepted,
  ClientCommandRequest,
  ClientContextScope,
  ClientEvent,
  ClientQueryRequest,
  ClientQueryResponse,
  StudioClient,
  SubscriptionScope,
} from "@omp-studio/client-contract";

/** Shape exposed by `apps/desktop/src/preload.cjs`. */
interface DshStudioBridge {
  openContext(scope: ClientContextScope): Promise<string>;
  bootstrap(contextId?: string): Promise<ClientBootstrap>;
  query(request: ClientQueryRequest, contextId?: string): Promise<ClientQueryResponse>;
  command(request: ClientCommandRequest, contextId?: string): Promise<ClientCommandAccepted>;
  subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void, contextId?: string): () => void;
  close(contextId?: string): Promise<void>;
}

declare global {
  interface Window {
    dshStudio?: DshStudioBridge;
  }
}

/** Create the workbench client over the desktop IPC bridge, or `undefined` in a plain browser. */
export function createDshStudioClient(): StudioClient | undefined {
  const bridge = window.dshStudio;
  if (bridge === undefined) return undefined;
  const api: OmpStudioDesktopApi = {
    openContext: (scope) => bridge.openContext(scope),
    bootstrap: (contextId) => bridge.bootstrap(contextId) as never,
    query: (request, contextId) => bridge.query(request as never, contextId) as never,
    command: (request, contextId) => bridge.command(request as never, contextId) as never,
    subscribe: (scope, listener, contextId) => bridge.subscribe(scope, listener as never, contextId),
    close: (contextId) => bridge.close(contextId),
  };
  return new StudioClientImpl(createDesktopTransport(api));
}
