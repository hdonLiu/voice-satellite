export const STABLE_ERROR_CODES = [
  "unsupported_version",
  "unauthorized",
  "invalid_message",
  "invalid_state",
  "busy",
  "connector_offline",
  "timeout",
  "cancelled",
  "backpressure",
  "execution_unknown",
  "internal",
] as const;

export type StableErrorCode = (typeof STABLE_ERROR_CODES)[number];

export class VoiceSatelliteError extends Error {
  public constructor(
    public readonly code: StableErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VoiceSatelliteError";
  }
}

export function toStableError(error: unknown): VoiceSatelliteError {
  if (error instanceof VoiceSatelliteError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new VoiceSatelliteError("cancelled", "operation cancelled", {
      cause: error,
    });
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new VoiceSatelliteError("timeout", "operation timed out", {
      cause: error,
    });
  }
  return new VoiceSatelliteError("internal", "internal operation failed", {
    cause: error,
  });
}
