/**
 * Ranking is intentionally unavailable until an employee-scoped REST contract exists.
 * Do not add a client-side query or an offline substitute here.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TopBar } from '../src/components/ui/TopBar';
import { Card } from '../src/components/ui/Card';
import { colors, spacing } from '../src/theme/tokens';
import { typography } from '../src/theme/typography';

export default function RankingScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="🏆 Ranking del Mes" showBack />
      <View style={styles.content}>
        <Card>
          <Text style={styles.title}>Ranking no disponible</Text>
          <Text style={[typography.dim, styles.description]}>
            Aún no está disponible para tu cuenta. Se habilitará cuando exista un contrato seguro para consultarlo.
          </Text>
        </Card>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: 'center', padding: spacing.screenPadding },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  description: { marginTop: 10, textAlign: 'center', lineHeight: 20 },
});
