import SupplierList from '../suppliers/list.js';
import { PartnerProvider } from '../suppliers/partner-context.js';
export default function CustomersPage() {
  return (
    <PartnerProvider role='customer'>
      <SupplierList />
    </PartnerProvider>
  );
}
