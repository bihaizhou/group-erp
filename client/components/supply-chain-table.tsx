import type { ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import { Button } from '#components/ui/button';

/** Application composition for real server pagination/sorting in execution pages. */
export function SupplyChainTable<T extends { id: string }>({
  rows,
  columns,
  total,
  page,
  pageSize,
  sorting,
  onSorting,
  empty,
  busy = false,
}: {
  rows: T[];
  columns: ColumnDef<T>[];
  total: number;
  page: number;
  pageSize: number;
  sorting: SortingState;
  onSorting?: (sorting: SortingState) => void;
  empty: ReactNode;
  busy?: boolean;
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
    enableMultiSort: false,
    state: { pagination: { pageIndex: page - 1, pageSize }, sorting },
    onSortingChange: (updater) =>
      onSorting?.(typeof updater === 'function' ? updater(sorting) : updater),
  });
  return (
    <div className='overflow-hidden rounded-lg border' aria-busy={busy}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((head) => (
                <TableHead
                  key={head.id}
                  aria-sort={
                    head.column.getCanSort()
                      ? head.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : head.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : 'none'
                      : undefined
                  }
                >
                  {head.isPlaceholder ? null : head.column.getCanSort() &&
                    onSorting ? (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='-ml-2 h-8 px-2'
                      disabled={busy}
                      onClick={head.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        head.column.columnDef.header,
                        head.getContext(),
                      )}
                      {head.column.getIsSorted() === 'asc' ? (
                        <ArrowUp />
                      ) : head.column.getIsSorted() === 'desc' ? (
                        <ArrowDown />
                      ) : (
                        <ArrowUpDown />
                      )}
                    </Button>
                  ) : (
                    flexRender(head.column.columnDef.header, head.getContext())
                  )}
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
              <TableCell colSpan={columns.length} className='h-48 p-6'>
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
