import { procurement } from './procurement-zh.js';
import { customerCopy } from './partner-copy.js';
const { requestUi: _requestUi, ...counterparty } = procurement;
export const customers = {
  ...customerCopy(counterparty),
  title: '销售',
  customers: '客户',
  attachRole: '为既有主体增加客户角色',
  attachRoleHint:
    '复用已有身份；供应商角色的状态、公司备注和适用范围继续独立维护。',
  chooseIdentity: '共享主体身份',
  roleExists: '此身份已具有客户角色，或已停用。',
};
