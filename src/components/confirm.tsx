import { useState } from "react";
import { create } from "zustand";
import { Button, Modal } from "./ui";

/**
 * In-app replacement for window.confirm(). Native browser popups are blocked in some embedded
 * browsers (they silently answer "no"), and they don't match the app anyway.
 *
 *   if (!(await ask({ title: "Delete this note?", danger: true }))) return;
 */

type Request = {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};

const useConfirm = create<{ request: Request | null }>(() => ({ request: null }));

export function ask(opts: Omit<Request, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().request?.resolve(false);
    useConfirm.setState({ request: { ...opts, resolve } });
  });
}

/** Rendered once, near the root of the app. */
export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  // Keep the last request around so the dialog keeps its text while animating out.
  const [shown, setShown] = useState<Request | null>(request);
  if (request && request !== shown) setShown(request);

  const answer = (ok: boolean) => {
    request?.resolve(ok);
    useConfirm.setState({ request: null });
  };

  return (
    <Modal
      open={!!request}
      onClose={() => answer(false)}
      title={shown?.title ?? ""}
      size="sm"
      top
      accent={shown?.danger ? "var(--neg)" : undefined}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            autoFocus
            onClick={() => answer(true)}
            className={shown?.danger ? "bg-neg text-white hover:opacity-90" : undefined}
          >
            {shown?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      {shown?.body && <p className="text-[15px] leading-relaxed text-muted">{shown.body}</p>}
    </Modal>
  );
}
