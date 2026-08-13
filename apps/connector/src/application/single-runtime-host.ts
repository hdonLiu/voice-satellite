import { VoiceSatelliteError } from "@voice-satellite/contracts";
import type {
  AgentConversation,
  AgentRuntimePort,
  RuntimeHealth,
  SessionBinding,
} from "../ports/agent-runtime.js";

export class SingleRuntimeHost {
  public constructor(private readonly runtime: AgentRuntimePort) {}

  public health(): Promise<RuntimeHealth> {
    return this.runtime.health();
  }

  public async open(binding: SessionBinding): Promise<AgentConversation> {
    const health = await this.runtime.health();
    if (!health.ready) {
      throw new VoiceSatelliteError(
        "connector_offline",
        "agent runtime is not ready",
      );
    }
    return this.runtime.open(binding);
  }
}
