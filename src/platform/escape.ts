/* Escape closes the top-most layer only: a « ? » bubble over a sheet closes alone, a question over a sheet closes
   alone. Sheets, bubbles and the context menu register here while they are open; one keyboard listener serves them. */
type Handler = (e: KeyboardEvent) => void;
const stack: Handler[] = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !stack.length) return;
  e.stopPropagation();
  stack[stack.length - 1](e);
}

/** while open, this layer answers Escape (when it is the last one opened). Returns the way to leave the stack. */
export function onEscape(handler: Handler): () => void {
  stack.push(handler);
  if (!listening && typeof document !== 'undefined') { document.addEventListener('keydown', onKey); listening = true; }
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}
