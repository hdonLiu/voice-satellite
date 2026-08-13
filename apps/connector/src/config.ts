import { resolve } from "node:path";
import { homedir } from "node:os";

export interface ConnectorConfig {
  readonly relayUrl: string;
  readonly relayToken: string;
  readonly stateFile: string;
  readonly openclawExecutable: string;
  readonly openclawArgs: readonly string[];
  readonly openclawCwd: string;
}

export function connectorConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ConnectorConfig {
  const relayUrl = required(env, "VS_RELAY_URL");
  const parsed = new URL(relayUrl);
  if (parsed.protocol !== "wss:" && env.VS_ALLOW_INSECURE_WS !== "true") {
    throw new Error(
      "VS_RELAY_URL must use wss:// (or explicitly set VS_ALLOW_INSECURE_WS=true for development)",
    );
  }
  return {
    relayUrl,
    relayToken: required(env, "VS_RELAY_CONNECTOR_TOKEN"),
    stateFile: resolve(
      env.VS_CONNECTOR_STATE_FILE ??
        `${homedir()}/.voice-satellite/sessions.json`,
    ),
    openclawExecutable: env.OPENCLAW_EXECUTABLE ?? "openclaw",
    openclawArgs: splitArgs(env.OPENCLAW_ACP_ARGS ?? "acp"),
    openclawCwd: resolve(env.OPENCLAW_WORKDIR ?? homedir()),
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function splitArgs(value: string): readonly string[] {
  const result = value.trim().split(/\s+/).filter(Boolean);
  if (result.length === 0)
    throw new Error("OPENCLAW_ACP_ARGS must not be empty");
  return result;
}
