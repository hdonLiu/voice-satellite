import type { DeviceId, TurnId } from "@voice-satellite/contracts";
import { VoiceSatelliteError } from "@voice-satellite/contracts";

export class TurnRegistry {
  readonly #active = new Map<DeviceId, TurnId>();

  public acquire(deviceId: DeviceId, turnId: TurnId): void {
    if (this.#active.has(deviceId)) {
      throw new VoiceSatelliteError(
        "busy",
        "device already has an active turn",
      );
    }
    this.#active.set(deviceId, turnId);
  }

  public release(deviceId: DeviceId, turnId: TurnId): void {
    if (this.#active.get(deviceId) === turnId) {
      this.#active.delete(deviceId);
    }
  }

  public isActive(deviceId: DeviceId, turnId: TurnId): boolean {
    return this.#active.get(deviceId) === turnId;
  }

  public get size(): number {
    return this.#active.size;
  }
}
