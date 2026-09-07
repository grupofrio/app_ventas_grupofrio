export type CustomerDeactivationReason =
  | 'not_exists'
  | 'permanently_closed'
  | 'does_not_want_buy'
  | 'moved'
  | 'duplicate'
  | 'other';

export type CustomerDeactivationState =
  | 'reported'
  | 'pending_sugey'
  | 'sugey_verified'
  | 'pending_angelica'
  | 'angelica_approved'
  | 'final_odoo_review'
  | 'approved'
  | 'rejected'
  | 'second_visit_required'
  | 'commercial_recovery'
  | 'applied';

export interface CustomerDeactivationReasonOption {
  value: CustomerDeactivationReason;
  label: string;
  requiresPhoto: boolean;
}

export interface CustomerDeactivationScope {
  companyId: number;
  employeeId: number;
  sessionId: string;
  partnerId: number;
  planId: number;
  operationalDate: string;
}

export interface CustomerDeactivationRequestPayload extends Record<string, unknown> {
  operation_id: string;
  stop_id: number;
  reason: CustomerDeactivationReason;
  comment: string;
  contact_person: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  captured_at: string;
  localPhotoUri?: string | null;
  _deactivationScope: CustomerDeactivationScope;
}

export interface CustomerDeactivationSummary {
  request_id: number;
  stop_id: number;
  partner_id: number;
  state: CustomerDeactivationState;
  reason: CustomerDeactivationReason;
}
