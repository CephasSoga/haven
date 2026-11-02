import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * If a page crashes, show what happened and a way out instead of a blank window.
 * Placed around each page, so the menu keeps working; `resetKey` (the page's address)
 * clears the error when you go somewhere else.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; fullScreen?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Haven crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={this.props.fullScreen ? "flex min-h-dvh items-center justify-center bg-canvas p-6" : "flex min-h-[60dvh] items-center justify-center"}>
        <div className="flex max-w-md flex-col items-center text-center">
          <span className="mb-5 flex size-14 items-center justify-center rounded-[20px] bg-neg/10 text-neg">
            <AlertTriangle className="size-6" />
          </span>
          <div className="font-serif text-3xl">Something went wrong</div>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            {this.props.fullScreen ? "Haven" : "This page"} ran into a problem it couldn't recover from. What you'd already saved isn't affected.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => location.reload()}>
              <RotateCw className="size-4" /> Reload Haven
            </Button>
            {!this.props.fullScreen && (
              <Button
                onClick={() => {
                  location.hash = "#/";
                  this.setState({ error: null });
                }}
              >
                Go to Today
              </Button>
            )}
          </div>
          <details className="mt-6 w-full text-left text-[12px] text-faint">
            <summary className="cursor-pointer select-none text-center">Details for troubleshooting</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-sunken p-3 font-mono text-[11.5px] text-muted">
              {`${error.name}: ${error.message}${error.stack ? `\n\n${error.stack.split("\n").slice(1, 8).join("\n")}` : ""}`}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
