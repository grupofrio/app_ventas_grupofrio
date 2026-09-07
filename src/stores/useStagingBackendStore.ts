import { create } from 'zustand';
import { isStagingIdentityAllowed, type StagingBackendIdentity } from '../services/stagingBackendIdentity.ts';

export class StagingBackendUnverifiedError extends Error {
  constructor() {
    super('Backend staging no verificado. Confirma host y DB antes de enviar operaciones.');
    this.name = 'StagingBackendUnverifiedError';
  }
}

const initialIdentity: StagingBackendIdentity = {
  status: 'unverified',
  baseUrl: '',
  host: null,
  db: null,
  reason: 'network_error',
};

export function createStagingMutationGuard(
  getIdentity: () => StagingBackendIdentity,
): (requestUrl: string) => void {
  return (requestUrl) => {
    const identity = getIdentity();
    if (!isStagingIdentityAllowed(identity)) {
      throw new StagingBackendUnverifiedError();
    }

    try {
      const requestOrigin = new URL(requestUrl).origin;
      const verifiedOrigin = new URL(identity.baseUrl).origin;
      if (requestOrigin !== verifiedOrigin) {
        throw new StagingBackendUnverifiedError();
      }
    } catch (error) {
      if (error instanceof StagingBackendUnverifiedError) throw error;
      throw new StagingBackendUnverifiedError();
    }
  };
}

type StagingBackendState = {
  identity: StagingBackendIdentity;
  setIdentity: (identity: StagingBackendIdentity) => void;
  clearIdentity: () => void;
  assertMutationAllowed: (requestUrl: string) => void;
};

export const useStagingBackendStore = create<StagingBackendState>((set, get) => ({
  identity: initialIdentity,
  setIdentity: (identity) => set({ identity }),
  clearIdentity: () => set({ identity: initialIdentity }),
  assertMutationAllowed: (requestUrl) =>
    createStagingMutationGuard(() => get().identity)(requestUrl),
}));
