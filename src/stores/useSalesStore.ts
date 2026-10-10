import { create } from 'zustand';
import {
  fetchSalesList,
  fetchSalesSummary,
  GFSalesListResult,
  GFSalesOrder,
  GFSalesSummary,
} from '../services/gfLogistics';
import {
  mergeSalesOrderRows,
  normalizeAcceptedLocalSale,
  type AcceptedLocalSale,
} from '../services/checkoutSaleEvidence';

const EMPTY_SUMMARY: GFSalesSummary = {
  date: '',
  orders_count: 0,
  sales_amount_total: 0,
  amount_untaxed_total: 0,
  amount_tax_total: 0,
  kg_total: 0,
  avg_ticket: 0,
  monthly_target: 0,
  monthly_achieved: 0,
  cash_amount_total: 0,
  credit_amount_total: 0,
};

interface SalesState {
  summary: GFSalesSummary;
  orders: GFSalesOrder[];
  count: number;
  isLoading: boolean;
  error: string | null;
  lastLoadedAt: number | null;
  loadTodaySales: (options?: { force?: boolean }) => Promise<void>;
  rememberAcceptedOrder: (sale: AcceptedLocalSale) => void;
  mergeRemoteOrders: (orders: readonly GFSalesOrder[]) => void;
  reset: () => void;
}

// force=true no lanza cargas concurrentes: se adhiere (coalesce) a la petición
// activa si existe.
let activeLoad: Promise<void> | null = null;

export const useSalesStore = create<SalesState>((set, get) => ({
  summary: EMPTY_SUMMARY,
  orders: [],
  count: 0,
  isLoading: false,
  error: null,
  lastLoadedAt: null,

  loadTodaySales: async (options) => {
    if (get().isLoading) {
      if (options?.force && activeLoad) return activeLoad;
      return;
    }
    set({ isLoading: true, error: null });

    const load = (async () => {
      try {
        const [summary, list]: [GFSalesSummary, GFSalesListResult] = await Promise.all([
          fetchSalesSummary(),
          fetchSalesList(),
        ]);

        const orders = mergeSalesOrderRows(list.orders, get().orders);
        set({
          summary,
          orders,
          count: orders.length,
          isLoading: false,
          error: null,
          lastLoadedAt: Date.now(),
        });
      } catch (error) {
        // Un fallo remoto NO borra summary/orders previos: offline la pantalla
        // conserva lo último conocido y las tarjetas locales siguen visibles.
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : 'No se pudieron cargar las ventas.',
        });
      } finally {
        activeLoad = null;
      }
    })();

    activeLoad = load;
    return load;
  },

  rememberAcceptedOrder: (sale) => {
    const normalized = normalizeAcceptedLocalSale(sale);
    if (!normalized) return;
    const order: GFSalesOrder = {
      id: normalized.orderId,
      name: normalized.name,
      partner_id: normalized.partnerId,
      partner_name: normalized.partnerName ?? '',
      amount_total: normalized.amount,
      amount_untaxed: normalized.amount,
      amount_tax: 0,
      kg_total: 0,
      state: 'sale',
      date_order: '',
      confirmation_date: '',
      stop_id: normalized.stopId,
      operation_id: normalized.operationId,
      payment_method: '',
      payment_method_label: '',
      employee_name: '',
      is_gift: false,
      lines: [{
        product_id: 0,
        product_name: '',
        quantity: 1,
        price_unit: normalized.amount,
        price_subtotal: normalized.amount,
        kg_total: 0,
      }],
    };
    const orders = mergeSalesOrderRows([order], get().orders.filter((item) => item.id !== order.id));
    set({ orders, count: orders.length });
  },

  mergeRemoteOrders: (remote) => {
    const orders = mergeSalesOrderRows(remote, get().orders);
    set({ orders, count: orders.length });
  },

  reset: () => set({
    summary: EMPTY_SUMMARY,
    orders: [],
    count: 0,
    isLoading: false,
    error: null,
    lastLoadedAt: null,
  }),
}));
