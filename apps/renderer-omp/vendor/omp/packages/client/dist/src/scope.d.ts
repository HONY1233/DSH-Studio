/**
 * Exact subscription scope filtering, shared by the in-process memory
 * transport and the StudioClientImpl listener fan-out so both agree on
 * which events a scope receives.
 */
import type { ClientEvent, SubscriptionScope } from "@omp-studio/client-contract";
export declare function eventMatchesScope(event: ClientEvent, scope: SubscriptionScope): boolean;
//# sourceMappingURL=scope.d.ts.map