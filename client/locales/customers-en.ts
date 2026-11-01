import { procurement } from './procurement-en.js';
import { customerCopy } from './partner-copy.js';
const { requestUi: _requestUi, ...counterparty } = procurement;
export const customers = {
  ...customerCopy(counterparty),
  title: 'Sales',
  customers: 'Customers',
  attachRole: 'Add customer role to shared identity',
  attachRoleHint:
    'Reuse the existing identity. Its supplier role keeps its own status, company notes and applicability.',
  chooseIdentity: 'Shared identity',
  roleExists: 'This identity already has a customer role or is inactive.',
};
