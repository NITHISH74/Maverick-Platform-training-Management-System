import { cn } from "@/lib/utils";

/**
 * Standardised status pills for the whole app (F5 / UI polish).
 *
 * The spec calls out a fixed palette mapping so the same status string looks
 * identical on every page:
 *
 *   running          green
 *   planned          blue
 *   completed        gray
 *   closed           dark gray
 *   not_cleared      red
 *   cleared/offered  green
 *
 * Pages should prefer `<StatusBadge status="running" />` to ad-hoc inline
 * Badges where possible. The default variant falls back to a neutral gray so
 * an unrecognised status still renders without errors.
 */

const STATUS_STYLES: Record<string, string> = {
  // batches
  running:      "bg-green-100 text-green-800 ring-green-600/20 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/30",
  planned:      "bg-blue-100 text-blue-800 ring-blue-600/20 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/30",
  completed:    "bg-gray-100 text-gray-700 ring-gray-500/20 dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-400/30",
  closed:       "bg-gray-200 text-gray-600 ring-gray-500/30 dark:bg-gray-600/30 dark:text-gray-400 dark:ring-gray-500/30",
  archived:     "bg-gray-200 text-gray-600 ring-gray-500/30 dark:bg-gray-600/30 dark:text-gray-400 dark:ring-gray-500/30",

  // candidates
  cleared:      "bg-green-100 text-green-800 ring-green-600/20 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/30",
  offered:      "bg-green-100 text-green-800 ring-green-600/20 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/30",
  onboarded:    "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30",
  active:       "bg-blue-100 text-blue-800 ring-blue-600/20 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/30",
  not_cleared:  "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30",
  discontinued: "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30",
  dropped:      "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30",

  // attendance
  present:      "bg-green-100 text-green-800 ring-green-600/20 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/30",
  absent:       "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30",
  leave:        "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30",
};

const DEFAULT_STYLE =
  "bg-gray-100 text-gray-700 ring-gray-500/20 dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-400/30";

export interface StatusBadgeProps {
  status: string | null | undefined;
  className?: string;
  /** Override the visible label without changing the color mapping. */
  label?: string;
}

export function StatusBadge({ status, className, label }: StatusBadgeProps) {
  const key = (status ?? "").toString().toLowerCase().replace(/[\s-]+/g, "_");
  const style = STATUS_STYLES[key] ?? DEFAULT_STYLE;
  const display = label ?? (status ?? "—").toString().replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize",
        style,
        className,
      )}
    >
      {display}
    </span>
  );
}
