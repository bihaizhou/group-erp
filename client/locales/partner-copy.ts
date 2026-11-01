type CopyShape<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? { [K in keyof T]: CopyShape<T[K]> }
    : T extends object
      ? { [K in keyof T]: CopyShape<T[K]> }
      : T;
/** Static counterparty copy shares its structure; customer terminology stays explicit. */
export function customerCopy<T>(source: T): CopyShape<T> {
  const convert = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value
        .replaceAll('SUPPLIER_', 'CUSTOMER_')
        .replaceAll('Suppliers', 'Customers')
        .replaceAll('Supplier', 'Customer')
        .replaceAll('suppliers', 'customers')
        .replaceAll('supplier', 'customer')
        .replaceAll('采购', '销售')
        .replaceAll('供应商', '客户');
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, convert(item)]),
      );
    return value;
  };
  return convert(source) as CopyShape<T>;
}
