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
import { Checkbox } from '#components/ui/checkbox';
import type { IssueRequest } from './model.js';
export function ServerTable({
  rows,
  columns,
  total,
  page,
  pageSize,
  sorting,
  empty,
  selection,
}: {
  rows: IssueRequest[];
  columns: ColumnDef<IssueRequest>[];
  total: number;
  page: number;
  pageSize: number;
  sorting: SortingState;
  empty?: React.ReactNode;
  selection?: {
    selected: ReadonlySet<string>;
    onToggle: (id: string, checked: boolean) => void;
    onToggleAll: (checked: boolean) => void;
    label: string;
    selectAllLabel: string;
  };
}) {
  const allSelected =
    !!rows.length && rows.every((row) => selection?.selected.has(row.id));
  const someSelected = rows.some((row) => selection?.selected.has(row.id));
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
              {selection ? (
                <TableHead className='w-10'>
                  <Checkbox
                    aria-label={selection.selectAllLabel}
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onCheckedChange={(checked: boolean) => {
                      selection.onToggleAll(checked);
                    }}
                  />
                </TableHead>
              ) : null}
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
              <TableRow
                key={row.id}
                data-state={
                  selection?.selected.has(row.id) ? 'selected' : undefined
                }
              >
                {selection ? (
                  <TableCell className='w-10'>
                    <Checkbox
                      aria-label={`${selection.label} ${row.original.code}`}
                      checked={selection.selected.has(row.id)}
                      onCheckedChange={(checked: boolean) => {
                        selection.onToggle(row.id, checked);
                      }}
                    />
                  </TableCell>
                ) : null}
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
                colSpan={columns.length + (selection ? 1 : 0)}
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
