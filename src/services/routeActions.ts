/**
 * Shared catalog of GENERAL route actions — functions that apply to the
 * route / unit / day, NOT to a specific client. Used by both the map's
 * "Más" menu and (optionally) the list view, so the two never drift.
 *
 * Client-specific actions (venta, no venta, cobro, regalo, lealtad,
 * checkout, datos, editar, KoldScore) DO NOT belong here — they live inside
 * the client hub /stop/[id].
 */

export interface RouteGeneralAction {
  key: string;
  label: string;
  route: string;
  /** group for light visual separation in the menu */
  group: 'venta' | 'operacion' | 'cierre' | 'reportes';
}

export const ROUTE_GENERAL_ACTIONS: RouteGeneralAction[] = [
  // Ventas que NO son de un cliente del plan
  { key: 'offroute', label: '🔍 Venta especial / fuera de ruta', route: '/offroute', group: 'venta' },
  { key: 'presale', label: '📅 Preventa', route: '/presale', group: 'venta' },
  { key: 'newlead', label: '📋 Nuevo Lead', route: '/newcustomer', group: 'venta' },
  // Operación de la unidad / jornada
  { key: 'refill', label: '🔄 Recarga', route: '/refill-accept', group: 'operacion' },
  { key: 'incident', label: '🚩 Incidente', route: '/incident', group: 'operacion' },
  // Cierre del día
  { key: 'close', label: '🏁 Cerrar ruta', route: '/route-close', group: 'cierre' },
  // Reportes
  { key: 'analytics', label: '📈 Analíticas', route: '/analytics', group: 'reportes' },
  { key: 'ranking', label: '🏆 Ranking', route: '/ranking', group: 'reportes' },
];
