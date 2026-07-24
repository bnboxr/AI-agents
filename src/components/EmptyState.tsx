import { Link } from "@tanstack/react-router";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  action?: string;
  actionTo?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon = "📭",
  title,
  description,
  action,
  actionTo,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-lg font-bold text-[#e0e6ed] font-mono mb-2">
        {title}
      </h3>
      <p className="text-sm text-[#546e7a] max-w-sm mb-6">{description}</p>
      {action &&
        (actionTo ? (
          <Link
            to={actionTo}
            className="px-5 py-2 rounded-lg border border-[#00e676]/50 bg-[#00e676]/10 text-[#00e676] font-mono text-sm font-semibold hover:bg-[#00e676]/20 transition-all duration-200"
          >
            {action}
          </Link>
        ) : (
          <button
            onClick={onAction}
            className="px-5 py-2 rounded-lg border border-[#00e676]/50 bg-[#00e676]/10 text-[#00e676] font-mono text-sm font-semibold hover:bg-[#00e676]/20 transition-all duration-200"
          >
            {action}
          </button>
        ))}
    </div>
  );
}
