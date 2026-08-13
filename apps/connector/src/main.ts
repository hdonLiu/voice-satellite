import { OpenClawAcpRuntime } from "./adapters/agents/openclaw/openclaw-acp-runtime.js";
import { ConnectorCoordinator } from "./application/connector-coordinator.js";
import { SingleRuntimeHost } from "./application/single-runtime-host.js";
import { connectorConfigFromEnv } from "./config.js";
import { connectorDoctor } from "./doctor.js";
import { JsonFileSessionBindingStore } from "./infrastructure/json-file-session-store.js";
import { WsRelayClient } from "./transport/ws-relay-client.js";

const config = connectorConfigFromEnv();
if (process.argv.includes("--doctor")) {
  await connectorDoctor(config);
  process.exit(0);
}
const runtime = new OpenClawAcpRuntime({
  executable: config.openclawExecutable,
  args: config.openclawArgs,
  cwd: config.openclawCwd,
  stderr: (line) => console.error(`[openclaw] ${line}`),
});
const coordinator = new ConnectorCoordinator(
  new SingleRuntimeHost(runtime),
  new JsonFileSessionBindingStore(config.stateFile),
);
const client = new WsRelayClient(coordinator, {
  url: config.relayUrl,
  token: config.relayToken,
});
client.start();

async function shutdown(): Promise<void> {
  await client.stop();
  await runtime.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
