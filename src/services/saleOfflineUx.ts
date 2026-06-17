/**
 * UX de venta sin conexión (evidencia de campo: el vendedor arma la venta y solo
 * se entera al confirmar de que necesita conexión). Helper PURO / RN-free.
 *
 * Avisa ANTES (banner) y bajo el botón, sin habilitar venta offline: la venta
 * sigue siendo online-first y el guard de confirmación sigue bloqueando. NO se
 * deshabilita el botón a propósito — en campo la conectividad es intermitente y
 * un botón deshabilitado podría impedir confirmar en la ventana en que sí hay
 * señal; el guard + el modal claro cubren el caso offline de forma segura.
 */

export interface SaleOfflineUx {
  showBanner: boolean;
  bannerText: string;
  /** Texto bajo el botón "Confirmar Pedido" cuando no hay conexión. */
  buttonHint: string | null;
}

export function describeSaleOfflineUx(isOnline: boolean): SaleOfflineUx {
  if (isOnline) {
    return { showBanner: false, bannerText: '', buttonHint: null };
  }
  return {
    showBanner: true,
    bannerText: 'Sin conexión: puedes capturar la venta, pero para confirmarla necesitas conexión con Odoo.',
    buttonHint: 'Conecta el dispositivo para confirmar en Odoo.',
  };
}
