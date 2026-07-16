/**
 * KOLD Intelligence store — KoldScore + KoldDemand data.
 *
 * Both modules are OPTIONAL in Odoo. If not installed, returns null.
 * All consumers must handle null gracefully.
 *
 * Loading strategy:
 *   On plan load → batch-load scores + forecasts for all route partners.
 *   Results stored in Maps for O(1) lookup by partnerId.
 */

import { create } from 'zustand';
import { KoldScoreData, KoldForecastData, KoldCategory, KoldPriority } from '../types/kold';
import { getKoldInsights } from '../services/employeeData';
import { logInfo } from '../utils/logger';

interface KoldState {
  // Data maps (partnerId → data)
  scores: Map<number, KoldScoreData>;
  forecasts: Map<number, KoldForecastData>;

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
const KOLD_CATEGORIES = new Set<KoldCategory>([
  'joya', 'premium', 'diamante_en_bruto', 'en_peligro', 'trampa_operativa',
  'recuperacion', 'oportunidad_inmediata', 'bajo_retorno', 'estable', 'revisar',
]);
const KOLD_PRIORITIES = new Set<KoldPriority>(['critica', 'alta', 'media', 'baja', 'monitoreo']);

function asKoldCategory(value: string): KoldCategory {
  return KOLD_CATEGORIES.has(value as KoldCategory) ? value as KoldCategory : 'revisar';
}

function asKoldPriority(value: string): KoldPriority {
  return KOLD_PRIORITIES.has(value as KoldPriority) ? value as KoldPriority : 'monitoreo';
}

function asConfidenceLevel(value: string): KoldForecastData['confidence_level'] {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'low';
}

export const useKoldStore = create<KoldState>((set, get) => ({
  scores: new Map(),
  forecasts: new Map(),
  scoreModuleAvailable: null,
  demandModuleAvailable: null,
  isLoading: false,
  error: null,

  loadForPartners: async (partnerIds: number[]) => {
    if (partnerIds.length === 0) return;

    // Si ambos módulos ya se marcaron no disponibles en esta sesión, evitamos
    // solicitudes repetidas. reset() reinicia este estado al cerrar sesión.
    const state = get();
    const skipScore = state.scoreModuleAvailable === false;
    const skipDemand = state.demandModuleAvailable === false;
    if (skipScore && skipDemand) return;

    set({ isLoading: true, error: null });

    try {
      // Un único endpoint agregado por lote: no se expone el nombre de los
      // modelos ni se hacen peticiones N+1 por cliente.
      const insights = await getKoldInsights(partnerIds);
      const scoreMap = new Map<number, KoldScoreData>();
      const scoreAvailable = skipScore ? false : insights.scores_available;

      if (scoreAvailable) {
        for (const score of insights.scores) {
          if (score.partner_id) {
            scoreMap.set(score.partner_id, {
              id: score.id,
              partner_id: [score.partner_id, ''],
              score_master: score.score_master,
              category: asKoldCategory(score.strategic_category),
              priority: asKoldPriority(score.priority_level),
              action: score.suggested_action || score.recommendation_summary,
              explanation_text: score.recommendation_summary,
            });
          }
        }
      }

      const forecastMap = new Map<number, KoldForecastData>();
      const demandAvailable = skipDemand ? false : insights.forecasts_available;

      if (demandAvailable) {
        for (const forecast of insights.forecasts) {
          if (forecast.partner_id && !forecastMap.has(forecast.partner_id)) {
            // Take the first (most recent) forecast per partner
            forecastMap.set(forecast.partner_id, {
              id: forecast.id,
              partner_id: [forecast.partner_id, ''],
              forecast_date: forecast.forecast_date,
              predicted_kg: forecast.predicted_kg,
              probability_of_purchase: forecast.probability_of_purchase,
              confidence_level: asConfidenceLevel(forecast.confidence_level),
              confidence_score: forecast.confidence_score,
              lower_bound: 0,
              upper_bound: 0,
            });
          }
        }
      }

      if (!skipScore && !scoreAvailable) {
        logInfo('general', 'kold_score_disabled_for_session', {
          reason: 'employee kold insights reported scores unavailable',
        });
      }
      if (!skipDemand && !demandAvailable) {
        logInfo('general', 'kold_demand_disabled_for_session', {
          reason: 'employee kold insights reported forecasts unavailable',
        });
      }

      set({
        scores: scoreMap,
        forecasts: forecastMap,
        scoreModuleAvailable: scoreAvailable,
        demandModuleAvailable: demandAvailable,
        isLoading: false,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error loading KOLD data';
      set({ error: msg, isLoading: false });
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
    scoreModuleAvailable: null,
    demandModuleAvailable: null,
    isLoading: false,
    error: null,
  }),
}));
