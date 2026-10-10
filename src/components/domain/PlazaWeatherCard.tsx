import React from 'react';
import { Text, View } from 'react-native';
import { usePlazaWeather } from '../../hooks/usePlazaWeather';
import { formatPlazaWeatherCard } from '../../services/plazaWeatherLogic';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLocationStore } from '../../stores/useLocationStore';
import { useRouteStore } from '../../stores/useRouteStore';
import { useSyncStore } from '../../stores/useSyncStore';
import { colors, radii } from '../../theme/tokens';
import { typography } from '../../theme/typography';

export function PlazaWeatherCard({ refreshToken = 0 }: { refreshToken?: number }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const employeeId = useAuthStore((s) => s.employeeId);
  const plazaName = useAuthStore((s) => s.employeeAnalyticPlazaName);
  const warehouseName = useAuthStore((s) => s.warehouseName);
  const plan = useRouteStore((s) => s.plan);
  const isOnline = useSyncStore((s) => s.isOnline);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);
  const weather = usePlazaWeather({
    isAuthenticated,
    employeeId,
    isOnline,
    hints: [plazaName, plan?.warehouse_name, warehouseName],
    deviceLatitude: latitude,
    deviceLongitude: longitude,
    plan,
    planId: plan?.plan_id ?? null,
    refreshToken,
  });
  const card = weather ? formatPlazaWeatherCard(weather) : null;

  return (
    <View style={styles.weatherCard}>
      <Text style={typography.stateIcon}>{card?.glyph ?? '🌤️'}</Text>
      <View style={styles.copy}>
        {card ? (
          <>
            <Text style={styles.weatherTemp}>{card.temperature}</Text>
            <Text style={styles.weatherCity}>{card.place}</Text>
            <Text style={styles.weatherSub}>{card.detail}</Text>
            <Text style={styles.weatherSub}>{card.updated}</Text>
          </>
        ) : (
          <Text style={styles.weatherCity}>Clima no disponible</Text>
        )}
      </View>
    </View>
  );
}

const styles = {
  weatherCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    padding: 10,
    paddingHorizontal: 14,
    borderRadius: radii.button,
    marginBottom: 14,
    backgroundColor: colors.primaryAlpha04,
  },
  copy: { flex: 1, marginLeft: 8 },
  weatherTemp: { ...typography.kpiValue },
  weatherCity: { ...typography.dimSmall },
  weatherSub: { ...typography.dimSmall },
};
