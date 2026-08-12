import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Wiring del PR dirección + navegación externa:
 *  #1 RouteStopPanel conecta la prop onNavigate (antes muerta) a un botón real;
 *  #2 stop/[stopId] muestra dirección (formatCustomerAddress) + botón Abrir en Maps;
 *  #3 checkin muestra dirección antes del check-in;
 *  #4 StopCard muestra dirección;
 *  #5 la cadena off-route conserva street/city hasta la parada virtual;
 *  #6 el mapa aclara que la línea es orden de visita, no ruta por calles;
 *  #7 el helper compartido (locationNavigation.ts) es el único punto con
 *     URIs nativas de navegación — F2.6 eliminó app/map.tsx (duplicaba el
 *     mapa) y portó su navegación turn-by-turn nativa al helper para que
 *     route.tsx/checkin/stop/offroute la compartan.
 */
const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const panel = read('src/components/domain/RouteStopPanel.tsx');
const stop = read('app/stop/[stopId].tsx');
const checkin = read('app/checkin/[stopId].tsx');
const stopCard = read('src/components/domain/StopCard.tsx');
const searchLogic = read('src/services/offrouteSearchLogic.ts');
const factory = read('src/services/virtualStopFactory.ts');
const store = read('src/stores/useRouteStore.ts');
const offroute = read('app/offroute.tsx');
const routeMap = read('src/components/domain/RouteMap.tsx');
const nav = read('src/services/locationNavigation.ts');
const action = read('src/services/stopNavigationAction.ts');
const routeScreen = read('app/(tabs)/route.tsx');

// #1 onNavigate ya NO es prop muerta: se invoca en el panel.
assert(/onNavigate\(focus\)/.test(panel), 'RouteStopPanel debe llamar onNavigate(focus)');
assert(panel.includes('formatCustomerAddress'), 'el panel muestra la dirección del focus');

// #2 stop/[stopId]: dirección + botón Maps con el helper.
assert(stop.includes('formatCustomerAddress'), 'stop debe formatear la dirección');
assert(stop.includes('openStopNavigation'), 'stop debe usar el helper compartido de navegación');
assert(/Abrir en Maps/.test(stop), 'stop debe exponer botón Abrir en Maps');

// #3 checkin: dirección visible en pre-check-in.
assert(checkin.includes('formatCustomerAddress'), 'checkin debe mostrar la dirección');

// #4 StopCard: dirección.
assert(stopCard.includes('formatCustomerAddress'), 'StopCard debe mostrar la dirección');

// #5 off-route conserva street/city end-to-end.
assert(/street: customer\.street/.test(searchLogic), 'search result conserva street del customer');
assert(/street: lead\.street/.test(searchLogic), 'search result conserva street del lead');
assert(/street\?: string \| null/.test(factory) || factory.includes('street?: string'),
  'el factory acepta street');
assert(/street: input\.street/.test(factory), 'el factory setea street en la parada virtual');
assert(/street: opts\?\.street/.test(store), 'addVirtualStop pasa street al factory');
assert(/street: result\.street/.test(offroute), 'offroute pasa street del resultado');

// #6 leyenda "orden de visita, no ruta por calles" en el mapa único.
assert(/no es ruta por calles/.test(routeMap), 'RouteMap debe aclarar que la línea no es ruta');
assert(/showOrderLegend/.test(routeMap), 'RouteMap solo muestra la leyenda con línea recta visible');

// #7 F2.6: stopNavigationAction.ts concentra la navegación — web/dirección
// PERO conserva la navegación nativa Android/iOS (P2 Codex, portada desde el
// app/map.tsx eliminado): no perder google.navigation al unificar el mapa.
// Vive separado de locationNavigation.ts (que se mantiene sin imports de
// react-native) porque tests/locationNavigation.test.ts importa ese módulo
// directo en Node puro.
assert(action.includes('buildStopNavigationUrls'), 'la acción reusa el resolver de URLs');
assert(/google\.navigation:q=/.test(action), 'la acción conserva navegación nativa Android');
assert(/maps:\/\/app\?daddr=/.test(action), 'la acción conserva navegación nativa iOS');
assert(routeScreen.includes('openStopNavigation'), 'route.tsx usa el helper compartido de navegación');
assert(checkin.includes('openStopNavigation'), 'checkin usa el helper compartido de navegación');
assert(offroute.includes('openStopNavigation'), 'offroute usa el helper compartido de navegación');

// #8 el helper: fallback por dirección REAL, sin place_id con nombre (P3).
assert(nav.includes('formatCustomerAddress'), 'el helper usa la dirección para el fallback');
assert(/formatted\.hasAddress/.test(nav), 'el helper navega por dirección cuando no hay geo');
assert(!/destination_place_id=/.test(nav), 'el helper no emite destination_place_id=<valor> (P3)');

console.log('address + external nav wiring tests: ok');
