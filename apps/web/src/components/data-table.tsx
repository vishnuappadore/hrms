"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/icon-button";

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}

interface DataTableProps<T> {
  /** Column ids double as the server sort keys (must be in the endpoint's allow-list). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: T[];
  meta?: ListMeta;
  isLoading?: boolean;
  /** Server sort string: "field" asc, "-field" desc. */
  sort?: string;
  onSortChange?: (sort: string | undefined) => void;
  onPageChange?: (page: number) => void;
}

/**
 * Server-driven table per docs/FRONTEND.md: pagination/sorting state lives in
 * the caller and maps 1:1 to the API's `?page&pageSize&sort` params; `meta`
 * comes from the `{ data, meta }` envelope. Export button slot comes with the
 * export endpoints (later phase).
 */
export function DataTable<T>({
  columns,
  data,
  meta,
  isLoading,
  sort,
  onSortChange,
  onPageChange,
}: DataTableProps<T>) {
  const t = useTranslations("table");
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const pages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  function cycleSort(columnId: string) {
    if (!onSortChange) return;
    if (sort === columnId) onSortChange(`-${columnId}`);
    else if (sort === `-${columnId}`) onSortChange(undefined);
    else onSortChange(columnId);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.columnDef.enableSorting === true;
                  const active =
                    sort === header.column.id
                      ? "asc"
                      : sort === `-${header.column.id}`
                        ? "desc"
                        : undefined;
                  const SortIcon =
                    active === "asc" ? ChevronUp : active === "desc" ? ChevronDown : ChevronsUpDown;
                  return (
                    <th
                      key={header.id}
                      className="whitespace-nowrap px-4 py-3 text-start text-[10.5px] font-medium text-muted-foreground"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => cycleSort(header.column.id)}
                          className="inline-flex items-center gap-1 transition hover:text-foreground"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIcon
                            className={active ? "h-3.5 w-3.5 text-primary" : "h-3.5 w-3.5"}
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {columns.map((_col, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div className="h-4 w-full max-w-32 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <SearchX className="h-7 w-7 opacity-60" strokeWidth={1.5} aria-hidden="true" />
                    <span className="text-sm">{t("noResults")}</span>
                  </div>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.total > 0 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
          <span>{t("totalRows", { total: meta.total })}</span>
          <div className="flex items-center gap-1.5">
            <IconButton
              label={t("previous")}
              disabled={meta.page <= 1}
              onClick={() => onPageChange?.(meta.page - 1)}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
            <span className="px-1 tabular-nums">{t("pageOf", { page: meta.page, pages })}</span>
            <IconButton
              label={t("next")}
              disabled={meta.page >= pages}
              onClick={() => onPageChange?.(meta.page + 1)}
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
