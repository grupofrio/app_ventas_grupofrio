import { DEFAULT_READ_TIMEOUT_MS, postRest } from './api';
import { createEmployeeDataClient } from './employeeDataLogic';

const client = createEmployeeDataClient({
  postRest,
  readTimeoutMs: DEFAULT_READ_TIMEOUT_MS,
});

export const searchEmployeeDirectory = client.searchEmployeeDirectory;
export const getEmployeeScopedLoyalty = client.getEmployeeScopedLoyalty;
export const updateEmployeeScopedContact = client.updateEmployeeScopedContact;
