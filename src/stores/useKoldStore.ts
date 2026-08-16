/**
 * KOLD Intelligence store — scoped employee insights and route-provided data.
 *
 * The app never queries arbitrary Kold models. Per-partner score/forecast
 * fields already present in route data remain available to the UI; the store
 * fetches only the bounded employee insights DTO.
 *
 * Loading strategy:
 *   On plan load → refresh employee-scoped insights.
 */

import { create } from 'zustand';
import { KoldScoreData, KoldForecastData, KoldCategory } from '../types/kold';
import { EmployeeKoldInsights, getEmployeeKoldInsights } from '../services/employeeData';

interface KoldState {
  // Data maps (partnerId → data)
  scores: Map<number, KoldScoreData>;
  forecasts: Map<number, KoldForecastData>;
  insights: EmployeeKoldInsights | null;

  // Module availability
  scoreModuleAvailable: boolean | null; // null = not checked yet
  demandModuleAvailable: boolean | null;

  // Loading state
  isLoading: boolean;
  error: string | null;

  // Actions
  loadForPartners: (partnerIds: number[]) => Promise<void>;
  getScore: (partnerId: number) => KoldScoreData | null;
  getForecast: (partnerId: number) => KoldForecastData | null;

  // Derived intelligence
  getCriticalPartners: () => number[];
  getHighOpportunityPartners: () => number[];
  getAlerts: () => KoldAlert[];
  reset: () => void;
}

export interface KoldAlert {
  partnerId: number;
  partnerName: string;
  type: 'critical' | 'warning' | 'opportunity';
  message: string;
  category?: KoldCategory;
  score?: number;
}

// Categories that need urgent attention
const CRITICAL_CATEGORIES: KoldCategory[] = ['en_peligro', 'recuperacion'];
const OPPORTUNITY_CATEGORIES: KoldCategory[] = ['diamante_en_bruto', 'oportunidad_inmediata'];

export const useKoldStore = create<KoldState>((set, get) => ({
  scores: new Map(),
  forecasts: new Map(),
  insights: null,
  scoreModuleAvailable: null,
  demandModuleAvailable: null,
  isLoading: false,
  error: null,

  loadForPartners: async (_partnerIds: number[]) => {

    set({ isLoading: true, error: null });

    try {
      const insights = await getEmployeeKoldInsights();

      set({
        insights,
        // Kold score/forecast fields are supplied only by scoped route/day
        // data. This DTO has no arbitrary model/field selection.
        scores: new Map(),
        forecasts: new Map(),
        scoreModuleAvailable: true,
        demandModuleAvailable: true,
        isLoading: false,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error loading KOLD data';
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  getScore: (partnerId) => get().scores.get(partnerId) || null,
  getForecast: (partnerId) => get().forecasts.get(partnerId) || null,

  getCriticalPartners: () => {
    const result: number[] = [];
    get().scores.forEach((score, pid) => {
      if (CRITICAL_CATEGORIES.includes(score.category)) {
        result.push(pid);
      }
    });
    return result;
  },

  getHighOpportunityPartners: () => {
    const result: number[] = [];
    get().scores.forEach((score, pid) => {
      if (OPPORTUNITY_CATEGORIES.includes(score.category)) {
        result.push(pid);
      }
    });
    return result;
  },

  getAlerts: () => {
    const alerts: KoldAlert[] = [];
    const scores = get().scores;

    scores.forEach((score, pid) => {
      const name = Array.isArray(score.partner_id) ? score.partner_id[1] : `Partner #${pid}`;

      if (score.category === 'en_peligro') {
        alerts.push({
          partnerId: pid,
          partnerName: name,
          type: 'critical',
          message: `${name} — en peligro. ${score.action || 'Visitar urgente.'}`,
          category: score.category,
          score: score.score_master,
        });
      } else if (score.category === 'recuperacion') {
        alerts.push({
          partnerId: pid,
          partnerName: name,
          type: 'warning',
          message: `${name} — recuperacion. ${score.action || 'Plan de recuperacion.'}`,
          category: score.category,
          score: score.score_master,
        });
      } else if (OPPORTUNITY_CATEGORIES.includes(score.category) && score.score_master >= 60) {
        alerts.push({
          partnerId: pid,
          partnerName: name,
          type: 'opportunity',
          message: `${name} — oportunidad alta. ${score.action || ''}`,
          category: score.category,
          score: score.score_master,
        });
      }
    });

    // Sort: critical first, then warning, then opportunity
    const order = { critical: 0, warning: 1, opportunity: 2 };
    return alerts.sort((a, b) => order[a.type] - order[b.type]);
  },

  reset: () => set({
    scores: new Map(),
    forecasts: new Map(),
    insights: null,
    scoreModuleAvailable: null,
    demandModuleAvailable: null,
    isLoading: false,
    error: null,
  }),
}));
