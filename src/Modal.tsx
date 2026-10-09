import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import "./Modal.css";

export default function Modal({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useLayoutEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    const initial = dialog.querySelector<HTMLElement>("[data-modal-focus]") ??
      dialog.querySelector<HTMLElement>("input, select, textarea");
    (initial ?? dialog).focus();
    const background = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
    function isolateBackground() {
      let branch = dialog?.parentElement;
      while (branch?.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling instanceof HTMLElement && sibling !== branch && !background.has(sibling)) {
            background.set(sibling, { inert: sibling.hasAttribute("inert"), ariaHidden: sibling.getAttribute("aria-hidden") });
            sibling.setAttribute("inert", "");
            sibling.setAttribute("aria-hidden", "true");
          }
        }
        branch = branch.parentElement;
      }
    }
    isolateBackground();
    const observer = new MutationObserver(isolateBackground);
    let branch = dialog.parentElement;
    while (branch?.parentElement) {
      observer.observe(branch.parentElement, { childList: true });
      branch = branch.parentElement;
    }
    document.body.style.overflow = "hidden";
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    )).filter((element) => !element.closest("[disabled]"));
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      } else if (event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) { event.preventDefault(); dialog?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    }
    function focusin(event: FocusEvent) {
      if (event.target instanceof Node && !dialog?.contains(event.target)) dialog?.focus();
    }
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      observer.disconnect();
      document.body.style.overflow = overflow;
      for (const [element, { inert, ariaHidden }] of background) {
        if (!inert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (opener instanceof HTMLElement && opener.isConnected && !opener.matches(":disabled")) opener.focus();
      else document.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus();
    };
  }, []);

  return <div className="modal-backdrop">
    <div className="finance-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}
      tabIndex={-1} ref={dialogRef}>
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="modal-close" type="button" aria-label={`Close ${title}`}
          disabled={busy} onClick={onClose}>×</button>
      </div>
      {children}
    </div>
  </div>;
}
