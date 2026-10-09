import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  loadCachedPlazaWeather,
  refreshPlazaWeather,
  type RefreshPlazaWeatherInput,
} from '../services/plazaWeather';
import type { PlazaWeatherSnapshot } from '../services/plazaWeatherLogic';

export function usePlazaWeather(
  input: RefreshPlazaWeatherInput & { isAuthenticated: boolean; refreshToken: number },
) {
  const [weather, setWeather] = useState<PlazaWeatherSnapshot | null>(null);
  const hintKey = input.hints.map((hint) => hint ?? '').join('|');

  useEffect(() => {
    if (!input.isAuthenticated) {
      setWeather(null);
      return;
    }
    let cancelled = false;
    void loadCachedPlazaWeather(input.employeeId).then((cached) => {
      if (!cancelled && cached) setWeather(cached);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [input.isAuthenticated, input.employeeId]);

  const run = useCallback((force: boolean) => {
    if (!input.isAuthenticated) return;
    void refreshPlazaWeather({
      employeeId: input.employeeId,
      isOnline: input.isOnline,
      hints: input.hints,
      deviceLatitude: input.deviceLatitude,
      deviceLongitude: input.deviceLongitude,
      plan: input.plan,
      planId: input.planId,
      force,
    }).then((next) => {
      if (next) setWeather(next);
    }).catch(() => undefined);
  }, [
    input.isAuthenticated,
    input.employeeId,
    input.isOnline,
    input.deviceLatitude,
    input.deviceLongitude,
    input.plan,
    input.planId,
    hintKey,
  ]);

  useFocusEffect(useCallback(() => {
    run(false);
  }, [run]));

  useEffect(() => {
    if (input.refreshToken > 0) run(true);
  }, [input.refreshToken, run]);

  return weather;
}
