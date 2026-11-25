import type { WorkspaceId } from "@omp-studio/client-contract";
export declare const MOBILE_ACCESS_CHANNELS: {
    readonly status: "omp-studio:mobile:status";
    readonly start: "omp-studio:mobile:start";
    readonly stop: "omp-studio:mobile:stop";
    readonly pair: "omp-studio:mobile:pair";
    readonly revoke: "omp-studio:mobile:revoke";
    readonly exportCertificate: "omp-studio:mobile:certificate";
};
export interface MobileAccessStatus {
    addresses: string[];
    projects: {
        id: WorkspaceId;
        name: string;
    }[];
    active?: {
        origin: string;
        workspaceName: string;
        fingerprint: string;
        paired: boolean;
    };
}
export interface MobileAccessApi {
    status(): Promise<MobileAccessStatus>;
    start(ip: string, workspaceId: WorkspaceId): Promise<void>;
    stop(): Promise<void>;
    pair(): Promise<{
        url: string;
        qr: string;
        expiresAt: number;
    }>;
    revoke(): Promise<void>;
    exportCertificate(): Promise<boolean>;
}
//# sourceMappingURL=mobile-access.d.ts.map