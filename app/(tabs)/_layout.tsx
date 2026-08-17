/**
 * Bottom tab navigator — 5 primary tabs.
 * Tareas / Alertas remain routable under Mi Día (href: null).
 */

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { colors, sizes } from '../../src/theme/tokens';
import { useTasksStore } from '../../src/stores/useTasksStore';
import {
  KOLD_FIELD_ALL_TABS,
  isPrimaryTab,
} from '../../src/services/koldFieldNavigation';

export default function TabsLayout() {
  const pendingCount = useTasksStore((s) => s.pendingCount);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: 'rgba(255,255,255,0.05)',
          borderTopWidth: 1,
          height: sizes.bottomNavHeight,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '600',
        },
      }}
    >
      {KOLD_FIELD_ALL_TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            href: isPrimaryTab(tab.name) ? undefined : null,
            tabBarIcon: ({ focused, color, size }) => {
              if (tab.name === 'index' && pendingCount > 0) {
                return (
                  <View
                    style={{
                      width: (size || 22) + 12,
                      height: (size || 22) + 4,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons
                      name={focused ? tab.iconActive : tab.icon}
                      size={size || 22}
                      color={color}
                    />
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {pendingCount > 9 ? '9+' : String(pendingCount)}
                      </Text>
                    </View>
                  </View>
                );
              }
              return (
                <Ionicons
                  name={focused ? tab.iconActive : tab.icon}
                  size={size || 22}
                  color={color}
                />
              );
            },
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 12,
  },
});
