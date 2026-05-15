/**
 * ErrorBoundary — React-level safety net.
 *
 * Without this, any uncaught error during render in the subtree causes
 * React 18 to unmount the entire tree from the throwing component up.
 * Operationally that looks like "the page kicked me out" — exactly the
 * symptom Jorge reported on 2026-05-15 with the fire_extinguisher photo
 * flow on a Box Truck inspection.
 *
 * This boundary catches the throw, shows the error inline, and exposes:
 *   - The message + (in dev) the component stack
 *   - A "Try again" button that resets the boundary so the user can
 *     recover without a full page reload
 *   - An optional onReset callback for the parent to clear state that
 *     might have caused the crash
 *
 * Wrap the inspection wizard, the WO modals, and any other large
 * conditionally-mounted subtree where an unmount would feel like a bug.
 */
import { Component } from 'react';
import { AlertCircle, RotateCcw, X } from 'lucide-react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Always log so prod console captures the stack even when the UI
    // shows the friendly message. Future: pipe to Sentry once wired.
    // eslint-disable-next-line no-console
    console.error(
      '[ErrorBoundary] caught error in subtree:',
      error,
      info?.componentStack,
    );
    this.setState({ info });
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
    this.props.onReset?.();
  };

  handleClose = () => {
    this.setState({ error: null, info: null });
    this.props.onClose?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error?.message || 'Unknown error';
    const stack = this.state.info?.componentStack || this.state.error?.stack;
    // Show the component stack only in dev — in prod it's noisy + useless
    // since names are mangled. The message and a generic apology suffice.
    const isDev = typeof window !== 'undefined' && window.location?.hostname === 'localhost';

    return (
      <div className="fixed inset-0 z-[100] bg-navy-950/95 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-navy-900 border border-accent-red/40 rounded-xl shadow-2xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-red/15 flex items-center justify-center shrink-0">
              <AlertCircle size={20} className="text-accent-red" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-white mb-1">
                {this.props.title || 'Something went wrong'}
              </h3>
              <p className="text-xs text-navy-300">
                {this.props.body
                  || "The page hit an unexpected error and we caught it before it kicked you out. Try again, or close to start over."}
              </p>
            </div>
          </div>
          <div className="rounded-md bg-navy-800/60 border border-navy-700 px-3 py-2 text-[11px] font-mono text-accent-red break-words">
            {message}
          </div>
          {isDev && stack && (
            <details className="text-[10px] text-navy-400">
              <summary className="cursor-pointer hover:text-white">Stack (dev only)</summary>
              <pre className="mt-2 text-[9px] overflow-auto max-h-40 whitespace-pre-wrap">
                {stack}
              </pre>
            </details>
          )}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-navy-800">
            {this.props.onClose && (
              <button
                onClick={this.handleClose}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-navy-700 text-navy-300 text-xs font-semibold hover:text-white hover:border-navy-600 cursor-pointer">
                <X size={12} /> Close
              </button>
            )}
            <button
              onClick={this.handleReset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent-blue text-white text-xs font-semibold hover:opacity-90 cursor-pointer">
              <RotateCcw size={12} /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
