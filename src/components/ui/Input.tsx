/**
 * Input — TextInput con label + error, mismo look que searchInput de
 * ProductPicker (colors.card, border, radii.button) pero como componente
 * compartido para F2.4 (formularios de checkin/checkout/newcustomer/etc.
 * hoy repiten este bloque de estilos pantalla por pantalla).
 */

import React from 'react';
import { View, Text, TextInput, TextInputProps, StyleSheet, ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../../theme/tokens';
import { typography, fonts } from '../../theme/typography';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, containerStyle, style, ...rest }: InputProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={typography.inputLabel}>{label}</Text> : null}
      <TextInput
        style={[typography.body, styles.input, error && styles.inputError, style]}
        placeholderTextColor={colors.textDim}
        {...rest}
      />
      {error ? <Text style={[typography.dimSmall, styles.errorText]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  input: {
    backgroundColor: colors.cardLighter,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: spacing.screenPadding * 2 + 6,
  },
  inputError: { borderColor: colors.error },
  errorText: { color: colors.error, fontFamily: fonts.bodyBold, fontWeight: '700' },
});
