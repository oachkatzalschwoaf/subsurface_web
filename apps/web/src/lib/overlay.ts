/**
 * Svelte action for a full-screen <dialog>: opens it as a modal (Escape and keeping the focus
 * inside come with that) and gives it a history entry of its own, so the phone's back button
 * closes the dialog instead of leaving the page underneath.
 *
 *   {#if open}<dialog use:overlay={close}>…</dialog>{/if}
 *
 * `close` must make the dialog go away (remove it from the page); back and Escape call it.
 */
export function overlay(dialog: HTMLDialogElement, close: () => void) {
  let onClose = close;
  let closedByHistory = false;
  const onPop = () => {
    closedByHistory = true;
    onClose();
  };
  // Escape: the same as the back button
  const onCancel = (e: Event) => {
    e.preventDefault();
    history.back();
  };
  history.pushState({ topsideOverlay: true }, '');
  window.addEventListener('popstate', onPop, { once: true });
  dialog.addEventListener('cancel', onCancel);
  dialog.showModal();
  return {
    update(next: () => void) {
      onClose = next;
    },
    destroy() {
      window.removeEventListener('popstate', onPop);
      dialog.removeEventListener('cancel', onCancel);
      // closed by the app (a button): drop the history entry it added
      if (!closedByHistory && (history.state as { topsideOverlay?: boolean } | null)?.topsideOverlay) history.back();
    },
  };
}
