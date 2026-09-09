import type { ConfigContext, ExpoConfig } from 'expo/config';
import { createEnvironmentConfig } from './src/config/appEnvironment.expo.js';

const EAS_PROJECT_ID = '0a24997e-51fe-417a-a8d7-4bc83a1d7dff';

const BASE_EXPO_CONFIG: ExpoConfig = {
  name: 'KOLD Field',
  slug: 'kold-field',
  owner: 'grupofrio',
  version: '1.4.2',
  orientation: 'portrait',
  icon: './assets/grupofrio-icon.png',
  userInterfaceStyle: 'dark',
  scheme: 'kold-field',
  splash: {
    image: './assets/grupofrio-splash.png',
    resizeMode: 'contain',
    backgroundColor: '#FFFFFF',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'mx.grupofrio.koldfield',
    config: {
      googleMapsApiKey: 'AIzaSyB0FE50kwn4t0l1JCruboPXqyVLHAtRzk8',
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'KOLD Field necesita tu ubicacion para verificar visitas a clientes.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'KOLD Field usa GPS para tracking de ruta del vendedor.',
      NSCameraUsageDescription:
        'KOLD Field necesita la camara para fotos de evidencia de visita.',
      UIBackgroundModes: ['location', 'fetch'],
    },
    appleTeamId: 'NSPZ9L84H2',
  },
  android: {
    package: 'mx.grupofrio.koldfield',
    versionCode: 6,
    allowBackup: false,
    config: {
      googleMaps: {
        apiKey: 'AIzaSyB0FE50kwn4t0l1JCruboPXqyVLHAtRzk8',
      },
    },
    adaptiveIcon: {
      backgroundColor: '#0F1419',
      foregroundImage: './assets/grupofrio-adaptive-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/grupofrio-adaptive-monochrome.png',
    },
    permissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.CAMERA',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.RECORD_AUDIO',
    ],
  },
  web: {
    favicon: './assets/grupofrio-favicon.png',
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'KOLD Field usa GPS para tracking de ruta.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        cameraPermission: 'KOLD Field necesita la camara para fotos de visita.',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          kotlinVersion: '1.9.25',
          kspVersion: '1.9.25-1.0.20',
          compileSdkVersion: 35,
          targetSdkVersion: 34,
          minSdkVersion: 24,
          buildToolsVersion: '35.0.0',
        },
        ios: {
          deploymentTarget: '15.1',
        },
      },
    ],
    './modules/thermal-printer/app.plugin.js',
  ],
  extra: {
    googleMapsApiKey: 'AIzaSyB0FE50kwn4t0l1JCruboPXqyVLHAtRzk8',
    eas: {
      projectId: EAS_PROJECT_ID,
    },
  },
};

export function buildExpoConfig(
  envOverrides: Record<string, string | undefined> = {},
): ExpoConfig {
  const env = createEnvironmentConfig({ ...process.env, ...envOverrides });
  const isProduction = env.environment === 'production';
  const appIcon = isProduction
    ? './assets/grupofrio-icon.png'
    : './assets/grupofrio-staging-icon.png';
  const adaptiveForeground = isProduction
    ? './assets/grupofrio-adaptive-foreground.png'
    : './assets/grupofrio-staging-adaptive-foreground.png';
  const webFavicon = isProduction
    ? './assets/grupofrio-favicon.png'
    : './assets/grupofrio-staging-favicon.png';

  return {
    ...BASE_EXPO_CONFIG,
    name: env.appName,
    slug: env.appSlug,
    scheme: env.appScheme,
    icon: appIcon,
    ios: {
      ...BASE_EXPO_CONFIG.ios,
      bundleIdentifier: `mx.grupofrio.koldfield${env.bundleSuffix}`,
    },
    android: {
      ...BASE_EXPO_CONFIG.android,
      versionCode: isProduction ? BASE_EXPO_CONFIG.android?.versionCode : 11,
      package: `mx.grupofrio.koldfield${env.bundleSuffix}`,
      adaptiveIcon: {
        ...BASE_EXPO_CONFIG.android?.adaptiveIcon,
        foregroundImage: adaptiveForeground,
      },
    },
    web: {
      ...BASE_EXPO_CONFIG.web,
      favicon: webFavicon,
    },
    extra: {
      ...BASE_EXPO_CONFIG.extra,
      appEnvironment: env.environment,
      defaultBaseUrl: env.defaultBaseUrl,
      defaultOdooDb: env.defaultOdooDb,
      stagingUseConfiguredDb: env.environment === 'staging'
        && (envOverrides.EXPO_PUBLIC_KF_STAGING_USE_CONFIGURED_DB ?? process.env.EXPO_PUBLIC_KF_STAGING_USE_CONFIGURED_DB) === 'true',
      eas: {
        projectId: EAS_PROJECT_ID,
      },
    },
  };
}

export default function appConfig(_context: ConfigContext): ExpoConfig {
  return buildExpoConfig();
}
