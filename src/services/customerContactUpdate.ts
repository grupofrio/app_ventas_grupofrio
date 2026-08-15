import { postRest } from './api';
import { normalizeEmployeeCustomerContactUpdate } from './customerContactUpdateLogic';

const EMPLOYEE_API_BASE = '/gf/logistics/api/employee';

export * from './customerContactUpdateLogic';

export interface EmployeeCustomerContact {
  id: number;
  name: string;
  phone: string;
  mobile: string;
  email: string;
}

interface EmployeeCustomerContactUpdateResponse {
  ok: true;
  message: string;
  data: { customer: EmployeeCustomerContact };
}

/** Persiste únicamente los campos de contacto allowlisted del partner visible. */
export async function syncCustomerContactUpdate(
  payload: Record<string, unknown>,
): Promise<EmployeeCustomerContact> {
  const request = normalizeEmployeeCustomerContactUpdate(payload);
  const response = await postRest<EmployeeCustomerContactUpdateResponse>(
    `${EMPLOYEE_API_BASE}/customer/contact/update`,
    request,
  );
  const customer = response?.data?.customer;
  if (!response || response.ok !== true || !customer || typeof customer.id !== 'number') {
    throw new Error('La respuesta de contacto no cumple el contrato de empleado.');
  }
  return customer;
}
