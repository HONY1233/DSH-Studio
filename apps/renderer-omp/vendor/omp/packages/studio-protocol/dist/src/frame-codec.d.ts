import { type FrameHeader } from "./contracts/protocol.js";
import type { RuntimeEpoch } from "./contracts/ids.js";
export declare const DEFAULT_MAX_CONTROL_FRAME_BYTES: number;
export interface DecodedFrame<T = unknown> {
    header: FrameHeader;
    body: T;
}
export declare class FrameCodecError extends Error {
    constructor(message: string);
}
export declare function encodeFrame(frameId: string, runtimeEpoch: RuntimeEpoch, body: unknown, maxBytes?: number): Buffer;
export declare class FrameDecoder {
    #private;
    private readonly maxBytes;
    constructor(maxBytes?: number);
    push(chunk: Uint8Array): DecodedFrame[];
}
//# sourceMappingURL=frame-codec.d.ts.map