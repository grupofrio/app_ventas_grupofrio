/**
 * GPS service V2 — real location with permissions + adaptive modes.
 *
 * Uses expo-location for foreground location.
 * V2 ADDITIONS:
 *   - GPS modes: in_transit (5min), in_visit (check-in/out only), stopped (15min)
 *   - Mode-aware tracking intervals
 *   - Visit mode captures GPS ONLY at check-in and check-out
 *   - Mode transitions managed via setGpsMode()
 *
 * RULE: GPS NEVER blocks check-in, checkout, or sales.
 *       Check-in uses getCurrentPosition() which is independent of the
 *       tracking mode. GPS points are P3 telemetry — fire-and-forget.
 */

import * as Location from 'expo-location';
import { useLocationStore, LocationStatus } from '../stores/useLocationStore';
import { useSyncStore } from '../stores/useSyncStore';
import { useAuthStore } from '../stores/useAuthStore';
import { shouldAdmitGpsPoint } from '../utils/gpsBuffer';
import { logInfo, logWarn } from '../utils/logger';

// ═══ GPS Modes ═══

export type GpsMode = 'in_transit' | 'in_visit' | 'stopped';

interface GpsModeConfig {
  interval_ms: number | null;  // null = no periodic tracking
  accuracy: Location.Accuracy;
  distanceInterval: number;
}

const GPS_MODE_CONFIG: Record<GpsMode, GpsModeConfig> = {
  in_transit: {
    interval_ms: 300_000,    // 5 minutes
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 100,   // 100m minimum movement
  },
  in_visit: {
    interval_ms: null,       // No periodic — only check-in/check-out captures
    accuracy: Location.Accuracy.High,
    distanceInterval: 0,
  },
  stopped: {
    interval_ms: 900_000,   // 15 minutes
    accuracy: Location.Accuracy.Low,
    distanceInterval: 0,
  },
};

let _currentMode: GpsMode = 'in_transit';
let _watchSubscription: Location.LocationSubscription | null = null;
let _periodicTimer: ReturnType<typeof setInterval> | null = null;
const GPS_POSITION_TIMEOUT_MS = 8000;

/** Get current GPS mode. */
export function getGpsMode(): GpsMode {
  return _currentMode;
}

/**
 * Set GPS mode. Adjusts tracking interval and behavior.
 *
 * Transitions:
 *   App start → in_transit
 *   check_in() → in_visit (stops periodic, captures single point)
 *   check_out() → in_transit (resumes periodic)
 *   Sign out → stopLocationWatch (all tracking stops)
 */
export function setGpsMode(mode: GpsMode): void {
  if (_currentMode === mode) return;

  const prevMode = _currentMode;
  _currentMode = mode;

  logInfo('gps', 'mode_change', { from: prevMode, to: mode });

  // Restart tracking with new config
  if (mode === 'in_visit') {
    // Stop periodic tracking during visits
    stopPeriodicTracking();
  } else {
    // Start/restart periodic with new interval
    const config = GPS_MODE_CONFIG[mode];
    if (config.interval_ms) {
      startPeriodicTracking(config.interval_ms);
    }
  }
}

/**
 * Capture a single GPS point and enqueue it.
 * Used at check-in and check-out (in_visit mode).
 * This is separate from periodic tracking.
 */
export async function captureAndEnqueueGpsPoint(source: string): Promise<void> {
  try {
    const position = await getCurrentPosition();
    if (!position) return;

    const employeeId = useAuthStore.getState().employeeId;
    if (!employeeId) return;

    // For visit events, bypass the rate-limit buffer — these are
    // business-relevant GPS points, not telemetry.
    useSyncStore.getState().enqueue('gps', {
      employee_id: employeeId,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: position.accuracy,
      timestamp: Date.now(),
      source,
      mode: _currentMode,
    });

    logInfo('gps', 'visit_point_captured', { source, lat: position.latitude, lon: position.longitude });
  } catch (error) {
    logWarn('gps', 'visit_point_failed', { source, error: String(error) });
  }
}

// ═══ Periodic tracking ═══

function startPeriodicTracking(intervalMs: number): void {
  stopPeriodicTracking();

  _periodicTimer = setInterval(async () => {
    try {
      const position = await getCurrentPosition();
      if (!position) return;

      const employeeId = useAuthStore.getState().employeeId;
      if (!employeeId) return;

      // Run through admission buffer (rate limit, dedup, accuracy gate)
      const admission = shouldAdmitGpsPoint({
        employeeId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        timestamp: Date.now(),
      });

      if (!admission.accept) return;

      useSyncStore.getState().enqueue('gps', {
        employee_id: employeeId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        timestamp: Date.now(),
        source: 'foreground',
        mode: _currentMode,
      });
    } catch {
      // Silent — periodic tracking should never crash
    }
  }, intervalMs);
}

function stopPeriodicTracking(): void {
  if (_periodicTimer) {
    clearInterval(_periodicTimer);
    _periodicTimer = null;
  }
}

// ═══ Core GPS functions (preserved from V1) ═══

/**
 * Request location permissions and get initial position.
 */
export async function initializeGPS(): Promise<LocationStatus> {
  const store = useLocationStore.getState();

  try {
    store.setStatus('loading');

    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      store.setStatus('unavailable', 'Servicios de ubicacion desactivados');
      return 'unavailable';
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      store.setStatus('denied', 'Permiso de ubicacion denegado');
      return 'denied';
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    store.setLocation(
      position.coords.latitude,
      position.coords.longitude,
      position.coords.accuracy || 0
    );

    return 'ready';
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error de GPS';
    store.setStatus('error', msg);
    return 'error';
  }
}

/**
 * Start watching position for real-time UI updates.
 * Also starts periodic GPS enqueue based on current mode.
 */
export async function startLocationWatch(): Promise<void> {
  if (_watchSubscription) return;

  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return;

    _watchSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 5,
      },
      (position) => {
        useLocationStore.getState().setLocation(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy || 0
        );
      }
    );

    // Start periodic GPS enqueue based on current mode
    const config = GPS_MODE_CONFIG[_currentMode];
    if (config.interval_ms && _currentMode !== 'in_visit') {
      startPeriodicTracking(config.interval_ms);
    }

    logInfo('gps', 'watch_started', { mode: _currentMode });
  } catch (error) {
    logWarn('gps', 'watch_failed', { error: String(error) });
  }
}

/**
 * Stop all GPS tracking — foreground watch + periodic.
 */
export function stopLocationWatch(): void {
  if (_watchSubscription) {
    _watchSubscription.remove();
    _watchSubscription = null;
  }
  stopPeriodicTracking();
  _currentMode = 'in_transit'; // Reset mode

  logInfo('gps', 'watch_stopped', {});
}

/**
 * Get current position once (for check-in/check-out).
 * NEVER blocked by GPS mode — always works if permission is granted.
 */
export async function getCurrentPosition(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
} | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const currentPositionPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), GPS_POSITION_TIMEOUT_MS);
    });

    const position = await Promise.race([currentPositionPromise, timeoutPromise])
      || await Location.getLastKnownPositionAsync({
        maxAge: 10 * 60 * 1000,
        requiredAccuracy: 1000,
      });

    if (!position) return null;

    const result = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy || 0,
    };

    useLocationStore.getState().setLocation(
      result.latitude, result.longitude, result.accuracy
    );

    return result;
  } catch {
    return null;
  }
}
