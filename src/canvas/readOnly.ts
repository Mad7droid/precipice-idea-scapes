import { createContext, useContext } from "react";

/**
 * Whether the canvas may change the document.
 *
 * A context rather than a prop because React Flow constructs nodes itself: `ObjectNode` is
 * rendered by React Flow from `nodeTypes`, so the only ways to reach it are the node's `data`
 * — which is rebuilt from the Scape on every change, and read-only-ness is not part of the
 * document — or this.
 */
export const ReadOnlyContext = createContext(false);

export const useCanvasReadOnly = (): boolean => useContext(ReadOnlyContext);
