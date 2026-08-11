/**
 * BottomSheet — reemplazo de Alert.alert() para diálogos de confirmación
 * (F2.3). Alert.alert usa el diálogo nativo del OS: no respeta el tema
 * claro institucional ni la tipografía DM Sans/Space Mono del resto de
 * la app. Este componente es el reemplazo visual; migrar cada
 * `Alert.alert(...)` existente a `<BottomSheet>` es trabajo de F2.4
 * pantalla por pantalla, no de este commit.
 */

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../theme/tokens';
import { typography } from '../../theme/typography';

export interface BottomSheetAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions?: BottomSheetAction[];
  children?: React.ReactNode;
  style?: ViewStyle;
}

const variantStyles: Record<NonNullable<BottomSheetAction['variant']>, { bg: string; text: string }> = {
  primary: { bg: colors.primary, text: colors.textOnPrimary },
  secondary: { bg: colors.cardLighter, text: colors.text },
  danger: { bg: colors.errorAlpha12, text: colors.error },
};

export function BottomSheet({ visible, onClose, title, message, actions = [], children, style }: BottomSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.sheetWrap} onPress={() => {}}>
          <SafeAreaView edges={['bottom']} style={[styles.sheet, style]}>
            <View style={styles.handle} />
            {title ? <Text style={[typography.screenTitle, styles.title]}>{title}</Text> : null}
            {message ? <Text style={[typography.body, styles.message]}>{message}</Text> : null}
            {children}
            {actions.map((action, i) => {
              const v = variantStyles[action.variant ?? 'secondary'];
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.actionBtn, { backgroundColor: v.bg }]}
                  onPress={action.onPress}
                  activeOpacity={0.8}
                >
                  <Text style={[typography.button, { color: v.text }]}>{action.label}</Text>
                </TouchableOpacity>
              );
            })}
          </SafeAreaView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,42,61,0.4)',
    justifyContent: 'flex-end',
  },
  sheetWrap: { width: '100%' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.screenPadding,
    gap: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 6,
  },
  title: { textAlign: 'center' },
  message: { textAlign: 'center', color: colors.textDim },
  actionBtn: {
    minHeight: 50,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
