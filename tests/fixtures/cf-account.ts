import type { CfAccountState } from "@/lib/validation/cf-account";

// Local contract fixture only; never injected into production components.
export const emptyCfAccount: CfAccountState = {
    version: "cf-evidence/1", revision: 0, evidenceRevision: 0, handle: null,
    ownershipVerified: false, enabled: false, lastSyncedAt: null, lastFullScanAt: null,
    fullScanUpperId: null, oldestObservedAt: null, highWater: null, historyFrom: 1,
    historyInProgress: false, observedSubmissions: 0, acceptedProblems: 0,
    pendingSubmissions: 0, status: "unlinked", errorCode: null,
};
