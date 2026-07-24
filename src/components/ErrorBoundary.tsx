import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error | null;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#080a0f]">
      <div className="glass-card p-12 text-center max-w-lg border border-[#ff3d00]/30">
        <div className="text-6xl mb-6">⚠</div>
        <h1 className="text-2xl font-bold text-[#ff3d00] mb-4 font-mono">
          SYSTEM ERROR
        </h1>
        <p className="text-[#b0bec5] text-sm mb-6 font-mono">
          An unexpected error occurred. Please try again.
        </p>
        {error && (
          <pre className="text-left text-xs text-[#546e7a] bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4 mb-6 max-h-32 overflow-auto font-mono">
            {error.message}
          </pre>
        )}
        <button
          onClick={onReset}
          className="px-6 py-2.5 rounded-lg border border-[#00e676]/50 bg-[#00e676]/10 text-[#00e676] font-mono text-sm font-bold hover:bg-[#00e676]/20 transition-all duration-200"
        >
          RELOAD SYSTEM
        </button>
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onReset={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
