/**
 * Canonical bottom-tab destinations for Kold Field.
 * Tasks/Alerts stay routable but are NOT primary tabs — enter via Mi Día.
 */

export type KoldFieldTabIcon =
  | 'home-outline'
  | 'home'
  | 'map-outline'
  | 'map'
  | 'cube-outline'
  | 'cube'
  | 'cart-outline'
  | 'cart'
  | 'person-outline'
  | 'person'
  | 'checkbox-outline'
  | 'checkbox'
  | 'notifications-outline'
  | 'notifications';

export type KoldFieldTabDef = {
  name: string;
  title: string;
  icon: KoldFieldTabIcon;
  iconActive: KoldFieldTabIcon;
  /** When false, screen stays registered but is hidden from the tab bar. */
  primary: boolean;
};

export const KOLD_FIELD_PRIMARY_TABS: readonly KoldFieldTabDef[] = [
  { name: 'index', title: 'Mi día', icon: 'home-outline', iconActive: 'home', primary: true },
  { name: 'route', title: 'Ruta', icon: 'map-outline', iconActive: 'map', primary: true },
  { name: 'inventory', title: 'Inventario', icon: 'cube-outline', iconActive: 'cube', primary: true },
  { name: 'sales', title: 'Ventas', icon: 'cart-outline', iconActive: 'cart', primary: true },
  { name: 'me', title: 'Yo', icon: 'person-outline', iconActive: 'person', primary: true },
] as const;

/** Secondary screens kept under (tabs) for deep links / in-app navigation. */
export const KOLD_FIELD_SECONDARY_TABS: readonly KoldFieldTabDef[] = [
  { name: 'tasks', title: 'Tareas', icon: 'checkbox-outline', iconActive: 'checkbox', primary: false },
  { name: 'alerts', title: 'Alertas', icon: 'notifications-outline', iconActive: 'notifications', primary: false },
] as const;

export const KOLD_FIELD_ALL_TABS: readonly KoldFieldTabDef[] = [
  ...KOLD_FIELD_PRIMARY_TABS,
  ...KOLD_FIELD_SECONDARY_TABS,
];

export function primaryTabNames(): string[] {
  return KOLD_FIELD_PRIMARY_TABS.map((t) => t.name);
}

export function isPrimaryTab(name: string): boolean {
  return KOLD_FIELD_PRIMARY_TABS.some((t) => t.name === name);
}
