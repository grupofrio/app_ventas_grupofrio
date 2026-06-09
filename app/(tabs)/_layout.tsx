/**
 * Bottom tab navigator — 6 tabs.
 * "Tareas" tab shows a red badge when there are pending/in-progress tasks.
 */

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { colors, sizes } from '../../src/theme/tokens';
import { useTasksStore } from '../../src/stores/useTasksStore';

type TabIcon = keyof typeof Ionicons.glyphMap;

const tabs: { name: string; title: string; icon: TabIcon; iconActive: TabIcon }[] = [
  { name: 'index',     title: 'Inicio',     icon: 'home-outline',          iconActive: 'home' },
  { name: 'route',     title: 'Ruta',       icon: 'map-outline',           iconActive: 'map' },
  { name: 'inventory', title: 'Inventario', icon: 'cube-outline',          iconActive: 'cube' },
  { name: 'sales',     title: 'Ventas',     icon: 'cart-outline',          iconActive: 'cart' },
  { name: 'tasks',     title: 'Tareas',     icon: 'checkbox-outline',      iconActive: 'checkbox' },
  { name: 'alerts',    title: 'Alertas',    icon: 'notifications-outline', iconActive: 'notifications' },
];

/** Red dot badge shown on top of the tasks icon when count > 0. */
function TasksBadge({ count, color, size }: { count: number; color: string; size: number }) {
  return (
    <View style={{ width: size + 12, height: size + 4, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="checkbox" size={size || 22} color={color} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : String(count)}</Text>
        </View>
      )}
    </View>
  );
}

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
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => {
              if (tab.name === 'tasks') {
                const icon = focused ? 'checkbox' : 'checkbox-outline';
                return (
                  <View style={{ width: (size || 22) + 12, height: (size || 22) + 4, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={icon} size={size || 22} color={color} />
                    {pendingCount > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{pendingCount > 9 ? '9+' : String(pendingCount)}</Text>
                      </View>
                    )}
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
