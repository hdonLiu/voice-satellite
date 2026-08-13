import { OpenAiTranscriptionAsr } from "./adapters/speech/openai/openai-asr.js";
import { OpenAiPcmTts } from "./adapters/speech/openai/openai-tts.js";
import { relayConfigFromEnv } from "./config.js";
import { RelayServer } from "./server/relay-server.js";

const config = relayConfigFromEnv();
if (process.argv.includes("--check-config")) {
  console.log("relay configuration is valid");
  process.exit(0);
}
const server = new RelayServer(
  new OpenAiTranscriptionAsr(config.asr),
  new OpenAiPcmTts(config.tts),
  config.server,
);
const address = await server.start();
console.log(
  `voice-satellite relay listening on ${address.host}:${address.port}`,
);

async function shutdown(): Promise<void> {
  await server.stop();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
