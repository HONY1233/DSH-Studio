/**
 * Defensive deep clone for transport envelope data.
 *
 * Contract payloads are plain JSON data: primitives, arrays, records and
 * `Date` instances (preserved like the desktop transport). Anything else
 * (functions, symbols, class instances, Map/Set) is a protocol violation
 * and fails closed with {@link WebTransportError} instead of being
 * forwarded. `undefined` properties are preserved; the web adapter and its
 * api never share object identity, so neither side can observe the other's
 * later mutations.
 */
export declare function cloneEnvelopeValue<T>(value: T): T;
//# sourceMappingURL=clone.d.ts.map