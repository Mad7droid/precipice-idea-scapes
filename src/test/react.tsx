import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A thirty-line render harness. React Testing Library is deliberately cut from the stack, and
 * React 19 exports `act` itself, so mounting into a jsdom container needs nothing else.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

export interface Mounted {
  container: HTMLElement;
  unmount: () => void;
}

export function render(element: React.ReactElement): Mounted {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);

  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * Sets a controlled input's value the way a user would.
 *
 * React installs its own value setter on the element instance, so assigning `el.value`
 * directly is invisible to it. Calling the prototype setter first is what makes the
 * subsequent `input` event carry the new value.
 */
export function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function byLabel<T extends HTMLElement>(container: HTMLElement, label: string): T {
  const el = container.querySelector<T>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`No element with aria-label="${label}"`);
  return el;
}
