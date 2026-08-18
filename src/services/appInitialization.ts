export interface NonblockingAppInitializationDeps {
  startConnectivityMonitor: () => void;
  checkConnectivity: () => Promise<boolean>;
  initializeAppState: () => Promise<void>;
  onConfirmedOnline: () => void;
  onConnectivityError: (error: unknown) => void;
  onInitializationError: (error: unknown) => void;
  onReady: () => void;
}

/** Starts connectivity observation without making its probe part of app readiness. */
export async function runNonblockingAppInitialization(
  deps: NonblockingAppInitializationDeps,
): Promise<void> {
  let initializationComplete = false;
  let probeConfirmedOnline = false;
  let probeWakeIssued = false;
  const wakeAfterInitialization = () => {
    if (!initializationComplete || !probeConfirmedOnline || probeWakeIssued) return;
    probeWakeIssued = true;
    deps.onConfirmedOnline();
  };

  try {
    deps.startConnectivityMonitor();
    const probe = deps.checkConnectivity();
    void probe.then((online) => {
      probeConfirmedOnline = online;
      wakeAfterInitialization();
    }).catch(deps.onConnectivityError);
  } catch (error) {
    deps.onConnectivityError(error);
  }

  try {
    await deps.initializeAppState();
  } catch (error) {
    deps.onInitializationError(error);
  } finally {
    initializationComplete = true;
    deps.onReady();
    wakeAfterInitialization();
  }
}
