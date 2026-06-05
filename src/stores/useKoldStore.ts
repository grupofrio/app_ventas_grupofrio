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
import { KoldScoreData, KoldForecastData, KoldCategory } from '../types/kold';
import { koldRead } from '../services/odooRpc';
import { logInfo } from '../utils/logger';
import { todayLocalISO } from '../utils/localDate';

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

export const useKoldStore = create<KoldState>((set, get) => ({
  scores: new Map(),
  forecasts: new Map(),
  scoreModuleAvailable: null,
  demandModuleAvailable: null,
  isLoading: false,
  error: null,

  loadForPartners: async (partnerIds: number[]) => {
    if (partnerIds.length === 0) return;

    // BLD-20260424-KOLDACL: short-circuit. Si una sesión previa ya
    // confirmó que el usuario no tiene ACL para el módulo, dejamos de
    // pegar al endpoint para no spamear logs del backend ni gastar
    // datos del operador. La bandera se resetea con logout / reset().
    const state = get();
    const skipScore = state.scoreModuleAvailable === false;
    const skipDemand = state.demandModuleAvailable === false;
    if (skipScore && skipDemand) return;

    set({ isLoading: true, error: null });

    try {
      // Load KoldScore (defensive — module may not exist O usuario sin ACL)
      const scoreData = skipScore
        ? null
        : await koldRead<KoldScoreData>(
            'kold.customer.score',
            [['partner_id', 'in', partnerIds], ['active', '=', true]],
            ['id', 'partner_id', 'score_master', 'strategic_category',
             'priority_level', 'suggested_action_text', 'explanation_text'],
            500
          );

      const scoreMap = new Map<number, KoldScoreData>();
      // BLD-20260424-KOLDACL: koldRead ahora retorna null cuando el
      // backend reporta `{ error, case: -3 }` (ACL denied) o módulo no
      // disponible. En ese caso marcamos el módulo como NO disponible
      // por el resto de la sesión.
      const scoreAvailable = skipScore ? false : scoreData !== null;

      if (scoreData) {
        for (const s of scoreData) {
          const pid = Array.isArray(s.partner_id) ? s.partner_id[0] : null;
          if (pid) {
            scoreMap.set(pid, {
              ...s,
              // Normalize field names from Odoo → our types
              category: (s as any).strategic_category || 'revisar',
              priority: (s as any).priority_level || 'monitoreo',
              action: (s as any).suggested_action_text || '',
            });
          }
        }
      }

      // Load KoldDemand forecasts (defensive)
      const today = todayLocalISO();
      const forecastData = skipDemand
        ? null
        : await koldRead<KoldForecastData>(
            'kold.demand.forecast',
            [
              ['partner_id', 'in', partnerIds],
              ['forecast_type', '=', 'customer_day'],
              ['forecast_date', '>=', today],
              ['active', '=', true],
            ],
            ['id', 'partner_id', 'forecast_date', 'predicted_kg', 'predicted_revenue',
             'probability_of_purchase', 'confidence_level', 'confidence_score',
             'lower_bound', 'upper_bound', 'explanation_text', 'customer_family'],
            500
          );

      const forecastMap = new Map<number, KoldForecastData>();
      const demandAvailable = skipDemand ? false : forecastData !== null;

      if (forecastData) {
        for (const f of forecastData) {
          const pid = Array.isArray(f.partner_id) ? f.partner_id[0] : null;
          if (pid && !forecastMap.has(pid)) {
            // Take the first (most recent) forecast per partner
            forecastMap.set(pid, f);
          }
        }
      }

      // BLD-20260424-KOLDACL: log la transición a "no disponible" la
      // primera vez (no en cada plan refresh). Útil para diagnóstico
      // sin saturar el log persistido.
      if (!skipScore && !scoreAvailable) {
        logInfo('general', 'kold_score_disabled_for_session', {
          reason: 'koldRead returned null (likely ACL or module missing)',
        });
      }
      if (!skipDemand && !demandAvailable) {
        logInfo('general', 'kold_demand_disabled_for_session', {
          reason: 'koldRead returned null (likely ACL or module missing)',
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
