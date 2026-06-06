/**
 * Incident report screen — Sprint B.
 *
 * Minimal flow: pick category + severity + description → submit to
 * /pwa-ruta/incident-create, then show recent incidents from /pwa-ruta/my-incidents.
 *
 * Online-first. The backend derives employee/company from the token; plan/stop
 * association is NOT in the current contract (see SPRINT-B notes). If the
 * endpoint is unavailable, the error is shown honestly (no fake success).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { Badge } from '../src/components/ui/Badge';
import { colors, spacing, radii } from '../src/theme/tokens';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { createIncident, getMyIncidents } from '../src/services/routeIncidents';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  buildIncidentPayload,
  labelForIncidentType,
  labelForSeverity,
} from '../src/services/routeIncidentLogic';
import { GFIncident } from '../src/types/incident';

export default function IncidentScreen() {
  const router = useRouter();
  const employeeId = useAuthStore((s) => s.employeeId);
  const isOnline = useSyncStore((s) => s.isOnline);

  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [severityKey, setSeverityKey] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [recent, setRecent] = useState<GFIncident[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const loadRecent = useCallback(async () => {
    if (!employeeId || !isOnline) return;
    setLoadingRecent(true);
    try {
      const list = await getMyIncidents(employeeId);
      setRecent(list);
    } catch {
      // Recent list is best-effort; a failure here must not block reporting.
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  }, [employeeId, isOnline]);

  useEffect(() => { void loadRecent(); }, [loadRecent]);

  async function handleSubmit() {
    if (submitting) return;
    const built = buildIncidentPayload({ typeKey, severityKey, description });
    if (!built.ok) {
      Alert.alert('Falta información', built.reason);
      return;
    }
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate para reportar el incidente.');
      return;
    }
    setSubmitting(true);
    try {
      await createIncident(built.payload);
      setTypeKey(null);
      setSeverityKey(null);
      setDescription('');
      Alert.alert('Incidente reportado', 'Quedó registrado correctamente.');
      await loadRecent();
    } catch (err) {
      Alert.alert('Error al reportar', err instanceof Error ? err.message : 'Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Reportar incidente" showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>📶 Sin conexión. Reporta cuando tengas señal.</Text>
          </View>
        )}

        <Card>
          <Text style={styles.label}>Tipo de incidente</Text>
          <View style={styles.chipWrap}>
            {INCIDENT_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                style={[styles.chip, typeKey === cat.key && styles.chipOn]}
                onPress={() => setTypeKey(cat.key)}
              >
                <Text style={[styles.chipText, typeKey === cat.key && styles.chipTextOn]}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>Severidad</Text>
          <View style={styles.chipWrap}>
            {INCIDENT_SEVERITIES.map((sev) => (
              <TouchableOpacity
                key={sev.key}
                style={[styles.chip, severityKey === sev.key && styles.chipOn]}
                onPress={() => setSeverityKey(sev.key)}
              >
                <Text style={[styles.chipText, severityKey === sev.key && styles.chipTextOn]}>{sev.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>Descripción</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe brevemente qué pasó"
            placeholderTextColor={colors.textDim}
            multiline
          />

          <Button
            label={submitting ? 'Enviando…' : 'Reportar incidente'}
            variant="primary"
            onPress={handleSubmit}
            fullWidth
            disabled={submitting || !isOnline}
            loading={submitting}
            style={{ marginTop: 14 }}
          />
        </Card>

        <Text style={styles.sectionTitle}>RECIENTES</Text>
        {loadingRecent ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
        ) : recent.length === 0 ? (
          <Text style={styles.dim}>Sin incidentes recientes.</Text>
        ) : (
          recent.map((inc) => (
            <View key={inc.id} style={styles.recentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.recentName} numberOfLines={2}>{inc.name}</Text>
                <Text style={styles.recentMeta}>{labelForIncidentType(inc.incident_type)}</Text>
              </View>
              <Badge label={labelForSeverity(inc.severity)} variant="orange" />
            </View>
          ))
        )}

        <Button
          label="Volver"
          variant="secondary"
          onPress={() => router.back()}
          fullWidth
          style={{ marginTop: 16 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 12 },
  offlineBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(234,179,8,0.08)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.4)',
  },
  offlineText: { fontSize: 12, color: colors.text },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: radii.button,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, minHeight: 44, justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextOn: { color: '#FFFFFF' },
  input: {
    minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button,
    paddingHorizontal: 14, paddingVertical: 10, color: colors.text, fontSize: 14,
    backgroundColor: colors.card, textAlignVertical: 'top',
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7,
    color: colors.textDim, marginTop: 8,
  },
  dim: { fontSize: 13, color: colors.textDim },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.card, borderRadius: radii.button,
  },
  recentName: { fontSize: 13, fontWeight: '600', color: colors.text },
  recentMeta: { fontSize: 11, color: colors.textDim, marginTop: 2 },
});
