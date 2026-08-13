# Implementation plan

This plan takes Voice Satellite from an architecture-only repository to an
open-source v1.0 release. Estimates are engineering days and assume familiarity
with ESP-IDF and TypeScript.

The task IDs, dependencies, artifacts, and gates used for execution are defined
in the [task-level execution plan](execution-plan.zh-CN.md).

## Release definition

v1.0 delivers one ESP32-S3 device, one single-node Relay, one outbound Connector,
one OpenClaw voice agent, half-duplex PCM, push-to-talk plus optional WakeNet/VAD,
streaming ASR/TTS, cancellation, physical approval, signed OTA, conformance tests,
SBOMs, and reproducible public releases.

## Dependency graph

```text
P0 compatibility spikes
  -> P1 repository, domain, protocols, testkit
  -> P2 all-fake vertical slice
  -> P3A firmware audio/PTT ┐
     P3B real ASR/TTS       ├-> P4 real PTT end-to-end
     P3C real ACP adapter   ┘
  -> P5 WakeNet/UI/approval
  -> P6 security/reliability/OTA/deployment
  -> P7 conformance/docs/open-source v1.0
```

## P0: Compatibility spikes

Estimate: 5–8 days. This phase blocks implementation.

### Work

- Identify the exact ATK-DNESP32S3 board revision and independently document
  ES8388, I2S, PA, LCD, key, power, and memory wiring.
- Prove stable microphone recording and speaker playback.
- Test the candidate stable ESP-IDF, ESP-SR, and `esp_codec_dev` combination.
- Validate 16 kHz input and 24 kHz output, including a fixed 48 kHz codec fallback.
- On the target OpenClaw computer, prove ACP initialize, session creation/resume,
  prompt, streaming update, cancellation, permission behavior, and process restart.
- Determine whether the official ACP TypeScript SDK is compatible.
- Prove the selected streaming ASR and TTS providers with baseline PCM formats,
  cancellation, timeouts, reconnect behavior, and first-byte latency.
- Capture sanitized golden traces and pin candidate dependency versions.

### Deliverables

- board wiring/resource table
- audio and memory budget
- ADRs for framework, ACP, audio, and speech providers
- sanitized ACP and audio/provider traces
- go/no-go compatibility report

### Exit criteria

Microphone, speaker, ACP streaming/cancel, ASR, and TTS all work independently.

## P1: Repository, domain, and protocol freeze

Estimate: 5–7 days.

### Work

- Initialize pnpm workspace, strict TypeScript, ESP-IDF project, CI, formatting,
  tests, license checking, and dependency locks.
- Establish `devices/esp32/boards/atk-dnesp32s3` as the first device platform
  and board adapter, and
  `apps/connector/src/adapters/agents/openclaw` as the first single-Agent adapter.
- Implement domain identifiers and the turn state machine.
- Finalize Device Link v1 and Connector Link v1 envelopes, the fixed v1 audio
  contract, minimal Device hello payload, mandatory AgentRuntime contract, audio
  header, small stable error set, size limits, and failure semantics.
- Publish JSON Schemas and generated TypeScript DTOs.
- Build Fake Device, ASR, TTS, Connector, Relay, and ACP executable.
- Add valid and invalid golden traces.

### Exit criteria

- all schemas accept valid fixtures and reject invalid roles/versions/states
- v1 wire names and required fields are frozen
- future v1 changes may add optional fields but not rename existing semantics

## P2: All-fake vertical slice

Estimate: 7–10 days.

### Relay

- device and Connector WSS gateways with separated credentials
- connection registry and online status
- `TurnOrchestrator`, in-memory `TurnRegistry`, timeouts, and bounded queues
- Fake ASR, AgentPort over Connector WSS, sentence segmentation, Fake TTS
- cancellation and late-event suppression

### Connector

- outbound WSS, hello/ready, heartbeat, exponential reconnect with jitter
- request dispatch, bounded duplicate window, and Fake AgentRuntime
- text deltas, cancellation, terminal event and error mapping
- prove that Fake AgentRuntime and the future OpenClaw adapter use the same port

### Exit criteria

One hundred simulated audio-to-audio turns complete without leaked turns,
unbounded queues, duplicate agent execution, or output after cancellation.

Core ports freeze at this milestone.

## P3: Parallel real adapters

Estimate: 20–30 days total across parallel tracks.

### P3A: Firmware audio and push-to-talk

- initialize PSRAM, I2C, I2S, ES8388, LCD, and keys
- implement codec mute/gain/volume and pop-safe PA sequencing
- capture PCM16 16 kHz mono in 20 ms frames
- play PCM16 24 kHz through a bounded jitter buffer
- place DMA buffers in internal RAM and larger rings in PSRAM
- enforce capture/playback mutual exclusion
- implement push-to-talk, cancel, local diagnostics, and Fake Transport loops

Exit: 30-minute capture and playback tests and 100 PTT state cycles pass without
DMA overflow, watchdog, deadlock, or continuous memory loss.

### P3B: Streaming ASR/TTS

- implement provider adapters behind stable streaming ports
- map vendor errors to stable domain errors
- support provider heartbeat, timeout, cancellation, and connection cleanup
- segment Chinese/English text by punctuation and maximum length
- flush trailing text on agent completion
- enforce bounded output and slow-consumer policies

Exit: partial ASR never invokes the agent; final ASR invokes exactly once; TTS
starts on completed segments; cancellation stops all later audio.

### P3C: OpenClaw ACP

- implement under `apps/connector/src/adapters/agents/openclaw`
- supervise `openclaw acp` with `shell: false`
- keep stdout protocol-only and stderr log-only
- implement initialize, session binding, prompt, update, cancel, and terminal maps
- derive allowed local session keys inside Connector
- filter thoughts, paths, tool arguments/results, credentials, and unknown updates
- bound NDJSON line size and fail closed on malformed frames
- fail active work on ACP restart without replay

Exit: three turns preserve context; cancellation works; ACP process restart allows
the next turn; Relay cannot choose arbitrary OpenClaw sessions.

## P4: Real push-to-talk end-to-end

Estimate: 6–10 days. Target release: v0.1.0.

### Work

- connect firmware to real Relay with certificate validation and header auth
- configure Wi-Fi, Relay URL, token, and volume through a safe provisioning path
- stream device PCM to real ASR, final text to Connector/ACP, deltas to TTS, and
  audio back to the speaker
- show basic offline/listening/thinking/speaking/error states
- propagate physical cancellation through capture, ASR, ACP, TTS, and playback
- record latency and queue-watermark metrics

### Exit criteria

- 50 real turns complete
- three-turn conversation preserves context
- multi-sentence answers begin playback before agent completion
- cancellation stops local playback within 300 ms
- restart/reconnect never plays audio from an old turn
- every unavailable dependency returns a stable user-facing error

## P5: WakeNet, VAD, display, and approval

Estimate: 8–12 days. Target release: v0.2.0.

### Work

- create `ptt`, `wakenet`, and `headless` firmware profiles
- isolate ESP-SR behind a build option and separate adapter
- run single-mic WakeNet/VAD only while idle; keep v1 half-duplex and AEC off
- retain push-to-talk as a permanent fallback
- calibrate wake cooldown, no-speech timeout, VAD tail, and maximum input length
- display transcript, answer, state, offline/error, and permission prompts with
  bounded text and refresh rate
- add structured permission requests with physical allow/deny and deny-on-timeout

### Acoustic targets

- at least 90% wake detection over 50 standard trials at 0.5–2 m in a quiet room
- target no more than one false wake per hour over an eight-hour background test
- at least 95% test utterances preserve initial and final words
- end input 0.6–1.2 seconds after final speech, configurable

## P6: Reliability, security, deployment, and OTA

Estimate: 10–15 days. Target release: v0.9.0-rc.1.

### Relay

- health/readiness endpoints, role-scoped credentials, size/rate/turn limits
- graceful shutdown, bounded queues, redacted structured logs, and metrics
- Docker image, Compose, and Caddy/Nginx TLS examples
- no raw audio or transcript persistence by default

### Connector

- protected local configuration or platform secret store
- systemd, launchd, and Windows service templates
- health/doctor checks for Relay, OpenClaw CLI, Gateway, ACP, and voice agent
- atomic session binding persistence and robust process supervision

### Firmware

- task watchdogs, boot-loop safe mode, crash summaries, and resource metrics
- signed HTTPS OTA, two application slots, first-boot validation, and rollback
- optional Secure Boot, Flash Encryption, and NVS encryption production profile

### Exit criteria

- eight-hour and 500-turn tests pass
- no continuously growing heap, handles, turns, queues, or pending work
- OTA power interruption retains a bootable image and failed firmware rolls back
- malformed/oversized traffic cannot crash components or leak credentials
- an accepted request with uncertain disconnect is never replayed automatically

## P7: Conformance and open-source v1.0

Estimate: 5–8 days.

### Work

- finalize conformance suites and hardware-in-loop tests
- write build, flash, provision, deploy, install, recovery, and adapter guides
- generate firmware and Node SPDX SBOMs
- verify PTT firmware does not link ESP-SR
- complete notices, provenance, DCO, governance, threat model, and security process
- publish signed firmware, Relay image, Connector artifacts, checksums, and SBOMs
- validate reproducible setup from public documentation in clean environments

### v1.0 exit criteria

- public documentation is sufficient to build, flash, deploy, and connect
- a conforming Fake Device can replace the ESP32 implementation without changes
  to Relay or Connector
- Fake AgentRuntime and OpenClaw can replace each other without changes to Relay,
  Device Link, or Connector Link
- OpenClaw computer exposes no inbound public port
- OpenClaw credentials never appear in Relay or firmware
- three-turn context, streaming audio, cancellation, and physical approval work
- 500 turns pass without session crossover, stale audio, or permanent deadlock
- invalid versions, roles, sizes, and session selection are rejected
- all distributed artifacts carry correct license notices, SBOMs, checksums, and
  signatures

## Estimate

| Phase     |       Days |
| --------- | ---------: |
| P0        |        5–8 |
| P1        |        5–7 |
| P2        |       7–10 |
| P3        |      20–30 |
| P4        |       6–10 |
| P5        |       8–12 |
| P6        |      10–15 |
| P7        |        5–8 |
| **Total** | **66–100** |

One engineer should expect roughly 14–20 weeks. Three parallel owners for
firmware, Relay/speech, and Connector/ACP can target 8–12 weeks, with mandatory
integration gates after P1, P2, P4, and P6.
