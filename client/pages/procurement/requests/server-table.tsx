import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import type { PurchaseRequest } from './model.js';
export function ServerTable({
  rows,
  columns,
  total,
  page,
  pageSize,
  sorting,
  empty,
}: {
  rows: PurchaseRequest[];
  columns: ColumnDef<PurchaseRequest>[];
  total: number;
  page: number;
  pageSize: number;
  sorting: SortingState;
  empty?: React.ReactNode;
}) {
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualPagination: true,
    manualSorting: true,
    rowCount: total,
    state: { pagination: { pageIndex: page - 1, pageSize }, sorting },
  });
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((head) => (
                <TableHead key={head.id}>
                  {flexRender(head.column.columnDef.header, head.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className='h-24 text-center text-muted-foreground'
              >
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
