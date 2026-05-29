import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Drop-in loading rows for tables. Replaces inline "Loading…" text per F5.
 *
 * Usage inside an existing <TableBody>:
 *   {isLoading ? <TableSkeletonRows columns={6} rows={5} /> : actualRows}
 *
 * For standalone (not-in-a-table) skeleton bars, use the existing
 * <Skeleton> primitive directly.
 */

export function TableSkeletonRows({
  columns,
  rows = 4,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <TableCell key={c}>
              <Skeleton
                className={cn(
                  "h-4",
                  // Vary the width so the skeleton doesn't look like a perfect grid
                  c === 0 ? "w-3/4" : c === columns - 1 ? "w-1/3" : "w-2/3",
                )}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * Free-form 3-4 bar skeleton — for use outside table contexts (cards,
 * stat tiles, narrative panels).
 */
export function ContentSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-3",
            i === 0 ? "w-3/4" : i === lines - 1 ? "w-1/2" : "w-5/6",
          )}
        />
      ))}
    </div>
  );
}
