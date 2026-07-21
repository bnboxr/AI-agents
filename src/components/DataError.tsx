import { type ReactNode } from "react";

interface DataErrorProps {
  message?: string;
  onRetry?: () => void;
  children?: ReactNode;
}

/**
 * DataError — glass card with red accent for honest error display.
 * Use this instead of silently falling back to demo/fake data.
 *
 * Props:
 *   message  — the error message to display (default: "Data not fetching")
 *   onRetry  — optional callback for a retry button
 *   children — optional additional content (e.g. detailed error info)
 */
export function DataError({ message = "Data not fetching", onRetry, children }: DataErrorProps) {
  return (
    <div
      className="glass-card p-6 text-center animate-fade-in-up"
      style={{
        borderColor: "rgba(255,61,0,0.2)",
        background: "rgba(255,61,0,0.04)",
      }}
    >
      <div className="flex items-center justify-center gap-2 mb-3">
        <span className="text-2xl">⚠️</span>
        <span className="text-accent-red font-semibold text-sm font-mono">
          {message}
        </span>
      </div>

      {children && (
        <div className="text-xs text-gray-400 mt-2 mb-3">{children}</div>
      )}

      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-4 py-2 rounded-lg border border-accent-red/30 bg-accent-red/10 text-accent-red text-xs font-medium hover:bg-accent-red/20 transition-colors"
        >
          Retry
        </button>
      )}

      <p className="text-xs text-gray-500 mt-3">
        Live mode active — no demo fallback. Real data is unavailable.
      </p>
    </div>
  );
}
