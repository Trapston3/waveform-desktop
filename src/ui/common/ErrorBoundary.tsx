// src/ui/common/ErrorBoundary.tsx
// Reusable React ErrorBoundary providing clean Reset and Close recovery UI

import React from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
  onReset?: () => void;
  onClose?: () => void;
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught rendering error:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  private handleClose = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onClose?.();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const title = this.props.title || 'Something went wrong';
    const message = this.state.error?.message || 'An unexpected error interrupted this view.';

    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl"
      >
        <div className="liquid-glass-capsule w-full max-w-md rounded-3xl p-6 border border-white/15 shadow-2xl text-white space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-[#FA2D48] shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">{title}</h2>
                <p className="text-xs text-neutral-400">
                  WaveForm caught an error before it could crash the app.
                </p>
              </div>
            </div>
            {this.props.onClose && (
              <button
                type="button"
                onClick={this.handleClose}
                aria-label="Close"
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className="p-3 rounded-xl bg-black/40 border border-white/10 text-xs font-mono text-neutral-300 break-words max-h-28 overflow-y-auto">
            {message}
          </div>

          <div className="flex items-center justify-end gap-2.5">
            {this.props.onClose && (
              <button
                type="button"
                onClick={this.handleClose}
                className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                Close
              </button>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FA2D48] hover:brightness-110 text-xs font-bold text-white shadow-lg shadow-[#FA2D48]/30 transition-all cursor-pointer"
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
