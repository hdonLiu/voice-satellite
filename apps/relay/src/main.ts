import { OpenAiTranscriptionAsr } from "./adapters/speech/openai/openai-asr.js";
import { OpenAiPcmTts } from "./adapters/speech/openai/openai-tts.js";
import { WhisperCppAsr } from "./adapters/speech/whisper-cpp/whisper-cpp-asr.js";
import { ConsoleTranscriptSink } from "./adapters/transcript/console-transcript-sink.js";
import { relayConfigFromEnv, type RelayAsrConfig } from "./config.js";
import type { StreamingAsrPort } from "./ports/speech.js";
import { RelayServer } from "./server/relay-server.js";

const config = relayConfigFromEnv();
if (process.argv.includes("--check-config")) {
  console.log("relay configuration is valid");
  process.exit(0);
}
let server: RelayServer;
if (config.mode === "device-link") {
  server = new RelayServer(undefined, undefined, config.server);
} else if (config.mode === "transcribe") {
  server = new RelayServer(
    createAsr(config.asr),
    undefined,
    config.server,
    new ConsoleTranscriptSink(),
  );
} else {
  server = new RelayServer(
    createAsr(config.asr),
    new OpenAiPcmTts(config.tts),
    config.server,
  );
}

function createAsr(config: RelayAsrConfig): StreamingAsrPort {
  return config.provider === "whisper-cpp"
    ? new WhisperCppAsr(config.config)
    : new OpenAiTranscriptionAsr(config.config);
}
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
