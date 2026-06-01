// Generic client-side pagination over an in-memory list (admin tables, etc.).
// Clamps the requested page into range so callers never render an out-of-bounds
// page, and reports 1-based from/to indices for "Showing X–Y of N" labels.

export interface PageResult<T> {
  pageRows: T[];
  totalPages: number;
  // Requested page clamped into [1, totalPages].
  currentPage: number;
  // 1-based index of the first/last row shown; both 0 when the list is empty.
  from: number;
  to: number;
  total: number;
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): PageResult<T> {
  const total = items.length;
  const size = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const start = (currentPage - 1) * size;
  const pageRows = items.slice(start, start + size);
  return {
    pageRows,
    totalPages,
    currentPage,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + pageRows.length,
    total,
  };
}
