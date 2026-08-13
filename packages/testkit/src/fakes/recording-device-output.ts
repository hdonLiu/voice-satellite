import type {
  AudioFrame,
  PermissionDecision,
  PermissionRequest,
  TurnId,
  TurnPhase,
  TurnResult,
} from "@voice-satellite/contracts";
import type { DeviceOutputPort } from "@voice-satellite/relay";

export class RecordingDeviceOutput implements DeviceOutputPort {
  public readonly states: TurnPhase[] = [];
  public readonly transcripts: string[] = [];
  public readonly audioFrames: AudioFrame[] = [];
  public readonly permissions: PermissionRequest[] = [];
  public readonly results: TurnResult[] = [];

  public constructor(
    private readonly permissionDecision: PermissionDecision = "deny",
  ) {}

  public async state(_turnId: TurnId, state: TurnPhase): Promise<void> {
    this.states.push(state);
  }

  public async transcript(_turnId: TurnId, text: string): Promise<void> {
    this.transcripts.push(text);
  }

  public async audio(
    _turnId: TurnId,
    frames: AsyncIterable<AudioFrame>,
  ): Promise<void> {
    for await (const frame of frames) {
      this.audioFrames.push(frame);
    }
  }

  public async permission(
    request: PermissionRequest,
  ): Promise<PermissionDecision> {
    this.permissions.push(request);
    return this.permissionDecision;
  }

  public async finish(_turnId: TurnId, result: TurnResult): Promise<void> {
    this.results.push(result);
  }

  public decodedAudio(): string {
    return this.audioFrames
      .map((frame) => new TextDecoder().decode(frame.data))
      .join("");
  }
}
