type UnknownRecord = Record<string, unknown>;

type RestPost = (
  url: string,
  data: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

type EmployeeDataClientInput = {
  postRest: RestPost;
  readTimeoutMs: number;
};

const EMPLOYEE_API = '/gf/logistics/api/employee';

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function unwrapEmployeeEnvelope<T>(result: unknown): T | null {
  if (!isRecord(result)) return null;
  const data = result.data === undefined ? result : result.data;
  return isRecord(data) ? data as T : null;
}

function assertPositivePartnerId(partnerId: number): void {
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new Error('partner_id debe ser un entero positivo.');
  }
}

function clampDirectoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(20, Math.trunc(limit)));
}

export function createEmployeeDataClient({
  postRest,
  readTimeoutMs,
}: EmployeeDataClientInput) {
  return {
    async searchEmployeeDirectory(
      query: string,
      limit = 20,
    ): Promise<{ customers: unknown[]; leads: unknown[] }> {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return { customers: [], leads: [] };
      }

      const result = await postRest(
        `${EMPLOYEE_API}/directory/search`,
        { query: normalizedQuery, limit: clampDirectoryLimit(limit) },
        { timeoutMs: readTimeoutMs },
      );
      const data = unwrapEmployeeEnvelope<UnknownRecord>(result) ?? {};
      return {
        customers: Array.isArray(data.customers) ? data.customers : [],
        leads: Array.isArray(data.leads) ? data.leads : [],
      };
    },

    async getEmployeeScopedLoyalty(
      partnerId: number,
    ): Promise<Record<string, unknown> | null> {
      assertPositivePartnerId(partnerId);
      const result = await postRest(
        `${EMPLOYEE_API}/customer/loyalty`,
        { partner_id: partnerId },
        { timeoutMs: readTimeoutMs },
      );
      const data = unwrapEmployeeEnvelope<UnknownRecord>(result);
      return isRecord(data?.customer) ? data.customer : null;
    },

    async updateEmployeeScopedContact(
      partnerId: number,
      values: Record<string, string | false>,
    ): Promise<Record<string, unknown> | null> {
      assertPositivePartnerId(partnerId);
      const result = await postRest(
        `${EMPLOYEE_API}/customer/contact/update`,
        { partner_id: partnerId, values },
      );
      const data = unwrapEmployeeEnvelope<UnknownRecord>(result);
      return isRecord(data?.customer) ? data.customer : null;
    },
  };
}
