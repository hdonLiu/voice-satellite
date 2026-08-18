import {
  connectorCredential,
  deviceCredential,
  type RelayMode,
  type RelayServerOptions,
} from "./server/relay-server.js";
import type { OpenAiAsrConfig } from "./adapters/speech/openai/openai-asr.js";
import type { OpenAiTtsConfig } from "./adapters/speech/openai/openai-tts.js";
import type { WhisperCppAsrConfig } from "./adapters/speech/whisper-cpp/whisper-cpp-asr.js";

export type RelayAsrConfig =
  | { readonly provider: "openai"; readonly config: OpenAiAsrConfig }
  | { readonly provider: "whisper-cpp"; readonly config: WhisperCppAsrConfig };

interface BaseRelayConfig {
  readonly mode: RelayMode;
  readonly server: RelayServerOptions;
}

export interface DeviceLinkRelayConfig extends BaseRelayConfig {
  readonly mode: "device-link";
}

export interface TranscribeRelayConfig extends BaseRelayConfig {
  readonly mode: "transcribe";
  readonly asr: RelayAsrConfig;
}

export interface ConversationRelayConfig extends BaseRelayConfig {
  readonly mode: "conversation";
  readonly asr: RelayAsrConfig;
  readonly tts: OpenAiTtsConfig;
}

export type RelayConfig =
  DeviceLinkRelayConfig | TranscribeRelayConfig | ConversationRelayConfig;

export function relayConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RelayConfig {
  const mode = relayMode(env.VS_RELAY_MODE);
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
  const server = {
    host: env.VS_RELAY_HOST ?? "0.0.0.0",
    port: integer(env.VS_RELAY_PORT, 8787),
    mode,
    deviceCredentials: devices,
  };
  if (mode === "device-link") return { mode, server };

  const asr = asrConfig(env);
  if (mode === "transcribe") return { mode, server, asr };
  const apiKey = required(env, "OPENAI_API_KEY");
  const common = {
    apiKey,
    ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
  };
  return {
    mode,
    server: {
      ...server,
      connectorCredential: connectorCredential(
        env.VS_CONNECTOR_ID ?? "openclaw-primary",
        required(env, "VS_RELAY_CONNECTOR_TOKEN"),
      ),
    },
    asr,
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

function asrConfig(env: NodeJS.ProcessEnv): RelayAsrConfig {
  const provider = env.VS_ASR_PROVIDER ?? "openai";
  const language = env.OPENAI_TRANSCRIBE_LANGUAGE ?? "zh";
  if (provider === "whisper-cpp") {
    return {
      provider,
      config: {
        language,
        ...(env.WHISPER_CPP_URL ? { baseUrl: env.WHISPER_CPP_URL } : {}),
      },
    };
  }
  if (provider !== "openai") {
    throw new Error("VS_ASR_PROVIDER must be openai or whisper-cpp");
  }
  return {
    provider,
    config: {
      apiKey: required(env, "OPENAI_API_KEY"),
      ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
      model: env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
      language,
    },
  };
}

function relayMode(value: string | undefined): RelayMode {
  const mode = value ?? "conversation";
  if (
    mode !== "device-link" &&
    mode !== "transcribe" &&
    mode !== "conversation"
  ) {
    throw new Error(
      "VS_RELAY_MODE must be device-link, transcribe, or conversation",
    );
  }
  return mode;
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
