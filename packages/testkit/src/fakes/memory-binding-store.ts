import type { ConversationId } from "@voice-satellite/contracts";
import type {
  SessionBinding,
  SessionBindingStore,
} from "@voice-satellite/connector";

export class MemorySessionBindingStore implements SessionBindingStore {
  readonly #bindings = new Map<string, SessionBinding>();

  public async load(
    conversationId: ConversationId,
  ): Promise<SessionBinding | undefined> {
    return this.#bindings.get(conversationId);
  }

  public async save(binding: SessionBinding): Promise<void> {
    this.#bindings.set(binding.conversationId, binding);
  }

  public async remove(conversationId: ConversationId): Promise<void> {
    this.#bindings.delete(conversationId);
  }
}
