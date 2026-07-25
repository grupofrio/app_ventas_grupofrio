import { create } from 'zustand';
import {
  fetchSalesList,
  fetchSalesSummary,
  GFSalesOrder,
  GFSalesSummary,
} from '../services/gfLogistics';
import {
  createSalesLoadCoordinator,
  type SalesLoadOptions,
} from '../services/salesRefreshPolicy';

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
  loadTodaySales: (options?: SalesLoadOptions) => Promise<void>;
  reset: () => void;
}

export const useSalesStore = create<SalesState>((set, get) => {
  const loadTodaySales = createSalesLoadCoordinator<GFSalesSummary, GFSalesOrder>({
    fetchSummary: fetchSalesSummary,
    fetchList: fetchSalesList,
    getState: get,
    setState: (patch) => set(patch),
  });

  return {
    summary: EMPTY_SUMMARY,
    orders: [],
    count: 0,
    isLoading: false,
    error: null,
    lastLoadedAt: null,
    loadTodaySales,

    reset: () => set({
      summary: EMPTY_SUMMARY,
      orders: [],
      count: 0,
      isLoading: false,
      error: null,
      lastLoadedAt: null,
    }),
  };
});
