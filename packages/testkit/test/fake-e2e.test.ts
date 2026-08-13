import { setImmediate as nextTask } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  ConnectorCoordinator,
  SingleRuntimeHost,
} from "@voice-satellite/connector";
import {
  type AgentEvent,
  type AgentRequest,
  newId,
} from "@voice-satellite/contracts";
import {
  TurnOrchestrator,
  TurnRegistry,
  type AgentPort,
} from "@voice-satellite/relay";
import {
  FakeAgentRuntime,
  FakeStreamingAsr,
  FakeStreamingTts,
  MemorySessionBindingStore,
  RecordingDeviceOutput,
  fakeAudioFrames,
} from "../src/index.js";

describe("all-fake vertical slice", () => {
  async function collect(
    events: AsyncIterable<AgentEvent>,
  ): Promise<AgentEvent[]> {
    const collected: AgentEvent[] = [];
    for await (const event of events) {
      collected.push(event);
    }
    return collected;
  }

  it("streams one audio-to-audio turn through every stable port", async () => {
    const asr = new FakeStreamingAsr("今天天气怎么样？");
    const tts = new FakeStreamingTts();
    const runtime = new FakeAgentRuntime({
      response: "今天晴朗。适合出门！",
      deltaCharacters: 2,
    });
    const connector = new ConnectorCoordinator(
      new SingleRuntimeHost(runtime),
      new MemorySessionBindingStore(),
    );
    const output = new RecordingDeviceOutput();
    const registry = new TurnRegistry();
    const orchestrator = new TurnOrchestrator(
      registry,
      asr,
      connector satisfies AgentPort,
      tts,
      output,
      { segmenter: { minCharacters: 2, maxCharacters: 20 } },
    );

    const result = await orchestrator.run({
      deviceId: newId<"DeviceId">(),
      conversationId: newId<"ConversationId">(),
      turnId: newId<"TurnId">(),
      audio: fakeAudioFrames(),
    });

    expect(result).toEqual({
      status: "completed",
      transcript: "今天天气怎么样？",
    });
    expect(output.states).toEqual([
      "CAPTURING",
      "TRANSCRIBING",
      "WAITING_AGENT",
      "SPEAKING",
      "COMPLETED",
    ]);
    expect(output.decodedAudio()).toBe("今天晴朗。适合出门！");
    expect(tts.segments).toEqual(["今天晴朗。", "适合出门！"]);
    expect(runtime.runCount).toBe(1);
    expect(registry.size).toBe(0);
  });

  it("completes 100 turns without retaining active turn state", async () => {
    const asr = new FakeStreamingAsr("ping");
    const tts = new FakeStreamingTts();
    const runtime = new FakeAgentRuntime({ response: "pong." });
    const connector = new ConnectorCoordinator(
      new SingleRuntimeHost(runtime),
      new MemorySessionBindingStore(),
    );
    const output = new RecordingDeviceOutput();
    const registry = new TurnRegistry();
    const orchestrator = new TurnOrchestrator(
      registry,
      asr,
      connector satisfies AgentPort,
      tts,
      output,
      { segmenter: { minCharacters: 1, maxCharacters: 20 } },
    );
    const deviceId = newId<"DeviceId">();
    const conversationId = newId<"ConversationId">();

    for (let index = 0; index < 100; index++) {
      const result = await orchestrator.run({
        deviceId,
        conversationId,
        turnId: newId<"TurnId">(),
        audio: fakeAudioFrames(1),
      });
      expect(result.status, JSON.stringify(result)).toBe("completed");
      expect(registry.size).toBe(0);
    }

    expect(runtime.runCount).toBe(100);
    expect(runtime.closeCount).toBe(100);
    expect(asr.opened).toBe(100);
    expect(tts.opened).toBe(100);
  });

  it("propagates cancellation and releases both turn and connector state", async () => {
    const asr = new FakeStreamingAsr("cancel me");
    const tts = new FakeStreamingTts();
    const runtime = new FakeAgentRuntime({
      response: "this response must not be played",
      deltaDelayMs: 10_000,
    });
    const connector = new ConnectorCoordinator(
      new SingleRuntimeHost(runtime),
      new MemorySessionBindingStore(),
    );
    const output = new RecordingDeviceOutput();
    const registry = new TurnRegistry();
    const orchestrator = new TurnOrchestrator(
      registry,
      asr,
      connector satisfies AgentPort,
      tts,
      output,
    );
    const controller = new AbortController();
    const running = orchestrator.run({
      deviceId: newId<"DeviceId">(),
      conversationId: newId<"ConversationId">(),
      turnId: newId<"TurnId">(),
      audio: fakeAudioFrames(1),
      signal: controller.signal,
    });

    while (runtime.runCount === 0) {
      await nextTask();
    }
    controller.abort(new DOMException("cancelled by device", "AbortError"));

    await expect(running).resolves.toEqual({ status: "cancelled" });
    expect(output.audioFrames).toHaveLength(0);
    expect(runtime.cancelCount).toBe(1);
    expect(runtime.closeCount).toBe(1);
    expect(registry.size).toBe(0);
    expect(await connector.ready()).toBe(true);
  });

  it("denies a permission request through the structured path", async () => {
    const asr = new FakeStreamingAsr("delete something");
    const tts = new FakeStreamingTts();
    const runtime = new FakeAgentRuntime({
      permissionSummary: "Delete a test record",
      response: "Permission denied.",
    });
    const connector = new ConnectorCoordinator(
      new SingleRuntimeHost(runtime),
      new MemorySessionBindingStore(),
    );
    const output = new RecordingDeviceOutput("deny");
    const orchestrator = new TurnOrchestrator(
      new TurnRegistry(),
      asr,
      connector satisfies AgentPort,
      tts,
      output,
      { segmenter: { minCharacters: 1, maxCharacters: 40 } },
    );

    const result = await orchestrator.run({
      deviceId: newId<"DeviceId">(),
      conversationId: newId<"ConversationId">(),
      turnId: newId<"TurnId">(),
      audio: fakeAudioFrames(1),
    });

    expect(result.status).toBe("completed");
    expect(output.permissions).toHaveLength(1);
    expect(output.permissions[0]?.summary).toBe("Delete a test record");
    expect(runtime.permissionDecisions).toEqual(["deny"]);
  });

  it("enforces the Agent timeout budget", async () => {
    const runtime = new FakeAgentRuntime({
      response: "too late",
      deltaDelayMs: 10_000,
    });
    const connector = new ConnectorCoordinator(
      new SingleRuntimeHost(runtime),
      new MemorySessionBindingStore(),
    );
    const output = new RecordingDeviceOutput();
    const orchestrator = new TurnOrchestrator(
      new TurnRegistry(),
      new FakeStreamingAsr("wait"),
      connector satisfies AgentPort,
      new FakeStreamingTts(),
      output,
      { agentTimeoutMs: 5, turnTimeoutMs: 1_000 },
    );

    const result = await orchestrator.run({
      deviceId: newId<"DeviceId">(),
      conversationId: newId<"ConversationId">(),
      turnId: newId<"TurnId">(),
      audio: fakeAudioFrames(1),
    });

    expect(result).toMatchObject({ status: "failed", code: "timeout" });
    expect(runtime.cancelCount).toBe(1);
    expect(runtime.closeCount).toBe(1);
  });

  it("never replays a request after it has been accepted", async () => {
    const runtime = new FakeAgentRuntime({ response: "done." });
    const connector = new ConnectorCoordinator(
      new SingleRuntimeHost(runtime),
      new MemorySessionBindingStore(),
    );
    const request: AgentRequest = {
      deviceId: newId<"DeviceId">(),
      conversationId: newId<"ConversationId">(),
      turnId: newId<"TurnId">(),
      requestId: newId<"RequestId">(),
      text: "run once",
      deadlineMs: 1_000,
    };

    await collect(connector.run(request, new AbortController().signal));
    await expect(
      collect(connector.run(request, new AbortController().signal)),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(runtime.runCount).toBe(1);
  });
});
