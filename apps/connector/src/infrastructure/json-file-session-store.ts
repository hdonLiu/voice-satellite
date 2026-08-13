import { constants } from "node:fs";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConversationId } from "@voice-satellite/contracts";
import type { SessionBinding } from "../ports/agent-runtime.js";
import type { SessionBindingStore } from "../ports/session-binding-store.js";

interface StoreDocument {
  readonly version: 1;
  readonly bindings: Record<string, SessionBinding>;
}

export class JsonFileSessionBindingStore implements SessionBindingStore {
  #loaded = false;
  readonly #bindings = new Map<string, SessionBinding>();
  #writeChain = Promise.resolve();

  public constructor(private readonly path: string) {}

  public async load(
    conversationId: ConversationId,
  ): Promise<SessionBinding | undefined> {
    await this.#ensureLoaded();
    return this.#bindings.get(conversationId);
  }

  public async save(binding: SessionBinding): Promise<void> {
    await this.#ensureLoaded();
    this.#bindings.set(binding.conversationId, binding);
    await this.#persist();
  }

  public async remove(conversationId: ConversationId): Promise<void> {
    await this.#ensureLoaded();
    this.#bindings.delete(conversationId);
    await this.#persist();
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isDocument(parsed)) throw new Error("invalid session binding store");
      for (const [key, binding] of Object.entries(parsed.bindings))
        this.#bindings.set(key, binding);
      await chmod(this.path, 0o600);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
  }

  async #persist(): Promise<void> {
    const task = this.#writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temp = `${this.path}.tmp-${process.pid}`;
      const document: StoreDocument = {
        version: 1,
        bindings: Object.fromEntries(this.#bindings),
      };
      const handle = await open(temp, "w", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify(document, undefined, 2)}\n`,
          "utf8",
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, this.path);
      const directory = await open(dirname(this.path), constants.O_RDONLY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      await unlink(temp).catch(() => undefined);
    });
    this.#writeChain = task.catch(() => undefined);
    await task;
  }
}

function isDocument(value: unknown): value is StoreDocument {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (
    object.version !== 1 ||
    !object.bindings ||
    typeof object.bindings !== "object" ||
    Array.isArray(object.bindings)
  )
    return false;
  return Object.entries(object.bindings as Record<string, unknown>).every(
    ([key, entry]) => {
      if (!key || !entry || typeof entry !== "object") return false;
      const binding = entry as Record<string, unknown>;
      return (
        binding.conversationId === key &&
        (binding.nativeSessionRef === undefined ||
          typeof binding.nativeSessionRef === "string")
      );
    },
  );
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
