// F2: react-native-maps es 100% nativo y no compila para web (usa
// codegenNativeCommands). Este resolver lo redirige a un stub SOLO cuando
// platform === 'web' — Android/iOS siguen resolviendo el paquete real sin
// cambios. Uso exclusivo: preview local en navegador para verificar F2
// (re-tema visual). Ver src/shims/react-native-maps.web.tsx.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// F2.5: react-native-svg 15.x rompe en web con el resolver de "package
// exports" de Metro (falla resolviendo su import interno relativo
// "../../lib/extract/extractTransform" pese a que el archivo existe en
// disco) — mitigación conocida: volver a la resolución clásica por path.
// No afecta Android/iOS (ahí no se usa el bundle web).
config.resolver.unstable_enablePackageExports = false;

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-maps') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/shims/react-native-maps.web.tsx'),
    };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
