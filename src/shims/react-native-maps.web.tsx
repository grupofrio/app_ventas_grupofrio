/**
 * Stub de react-native-maps SOLO para web (metro.config.js redirige aquí
 * vía resolver.resolveRequest cuando platform === 'web'). react-native-maps
 * es 100% nativo (usa codegenNativeCommands) y no compila para web en
 * absoluto — sin este stub, Metro no puede armar el bundle web ni para
 * pantallas que no muestran mapa.
 *
 * Uso exclusivo: preview local en navegador durante F2 (verificación
 * visual del re-tema). No afecta Android/iOS — ahí se sigue resolviendo
 * el paquete real. No es una implementación de mapas para producción web.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

function MapPlaceholder({ children, style }: { children?: React.ReactNode; style?: unknown }) {
  return (
    <View style={[styles.placeholder, style as object]}>
      <Text style={styles.text}>🗺️ Mapa no disponible en preview web</Text>
      {children}
    </View>
  );
}

const MapView = React.forwardRef(function MapView(props: any, _ref: unknown) {
  return <MapPlaceholder style={props.style}>{props.children}</MapPlaceholder>;
});

export function Marker() {
  return null;
}
export function Polyline() {
  return null;
}
export const PROVIDER_GOOGLE = 'google';

export default MapView;

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E0F3FC',
  },
  text: { fontSize: 13, color: '#5B7285' },
});
