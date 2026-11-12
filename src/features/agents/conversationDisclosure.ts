import { createContext } from "react";

/** Disclosure choices belong to the open conversation, including scoped child activity. */
export interface ConversationScrollState {
  opened: Map<string, boolean>;
  revealed: Set<string>;
  scope: string;
  pause: () => void;
}

export const ConversationScroll = createContext<ConversationScrollState | null>(null);

/** Finding must expose all retained text, including folded activity and output previews. */
export const FoldedContent = createContext(false);

export function activityKey(state: ConversationScrollState | null, id: string): string {
  return state?.scope ? `${state.scope}/${id}` : id;
}

export function activityExpanded(state: ConversationScrollState | null, id: string): boolean {
  const key = activityKey(state, id);
  return state?.opened.get(key) ?? state?.revealed.has(key) ?? false;
}
