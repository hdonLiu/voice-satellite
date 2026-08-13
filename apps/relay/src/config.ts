import {
  connectorCredential,
  deviceCredential,
  type RelayServerOptions,
} from "./server/relay-server.js";
import type { OpenAiAsrConfig } from "./adapters/speech/openai/openai-asr.js";
import type { OpenAiTtsConfig } from "./adapters/speech/openai/openai-tts.js";

export interface RelayConfig {
  readonly server: RelayServerOptions;
  readonly asr: OpenAiAsrConfig;
  readonly tts: OpenAiTtsConfig;
}

export function relayConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RelayConfig {
  const apiKey = required(env, "OPENAI_API_KEY");
  const rawDevices = JSON.parse(
    required(env, "VS_RELAY_DEVICE_TOKENS"),
  ) as unknown;
  if (
    !rawDevices ||
    typeof rawDevices !== "object" ||
    Array.isArray(rawDevices)
  ) {
    throw new Error(
      "VS_RELAY_DEVICE_TOKENS must be a JSON object of device id to token",
    );
  }
  const devices = Object.entries(rawDevices).map(([id, token]) => {
    if (typeof token !== "string" || !token)
      throw new Error(`invalid token for device ${id}`);
    return deviceCredential(id, token);
  });
  if (devices.length === 0)
    throw new Error("at least one device credential is required");
  const common = {
    apiKey,
    ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
  };
  return {
    server: {
      host: env.VS_RELAY_HOST ?? "0.0.0.0",
      port: integer(env.VS_RELAY_PORT, 8787),
      deviceCredentials: devices,
      connectorCredential: connectorCredential(
        env.VS_CONNECTOR_ID ?? "openclaw-primary",
        required(env, "VS_RELAY_CONNECTOR_TOKEN"),
      ),
    },
    asr: {
      ...common,
      model: env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
      ...(env.OPENAI_TRANSCRIBE_LANGUAGE
        ? { language: env.OPENAI_TRANSCRIBE_LANGUAGE }
        : {}),
    },
    tts: {
      ...common,
      model: env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
      voice: env.OPENAI_TTS_VOICE ?? "alloy",
      ...(env.OPENAI_TTS_INSTRUCTIONS
        ? { instructions: env.OPENAI_TTS_INSTRUCTIONS }
        : {}),
    },
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error("invalid relay port");
  return parsed;
}
