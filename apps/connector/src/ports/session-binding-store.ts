import type { ConversationId } from "@voice-satellite/contracts";
import type { SessionBinding } from "./agent-runtime.js";

export interface SessionBindingStore {
  load(conversationId: ConversationId): Promise<SessionBinding | undefined>;
  save(binding: SessionBinding): Promise<void>;
  remove(conversationId: ConversationId): Promise<void>;
}
