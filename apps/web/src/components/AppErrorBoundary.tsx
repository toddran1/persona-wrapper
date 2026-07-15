import { Component, type ErrorInfo, type ReactNode } from "react";
import { logClientEvent } from "../lib/telemetry.js";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
  resetKey: number;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logClientEvent("client_render_error", {
      level: "error",
      error,
      message: `${error.message} (${info.componentStack?.slice(0, 250) ?? "no component stack"})`
    });
  }

  private retry = (): void => {
    this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="fatal-error-page" role="alert">
          <section className="fatal-error-card">
            <div className="eyebrow">Application error</div>
            <h1>Something went wrong.</h1>
            <p>The page hit an unexpected error. Try restoring the app, or reload if the problem continues.</p>
            <div className="fatal-error-actions">
              <button type="button" onClick={this.retry}>Try again</button>
              <button type="button" className="fatal-error-secondary" onClick={() => window.location.reload()}>Reload page</button>
            </div>
          </section>
        </main>
      );
    }

    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}
