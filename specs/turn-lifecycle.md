# Turn lifecycle

- Status: Draft

A turn contains one user utterance and the resulting agent response. A
conversation contains multiple turns and maps to a local agent session through
Connector-owned state.

## States

```text
NEW
  -> CAPTURING
  -> TRANSCRIBING
  -> WAITING_AGENT
  -> SPEAKING
  -> COMPLETED

Any non-terminal state -> CANCELLED | FAILED
```

Agent text and TTS may overlap: Relay can enter `SPEAKING` after the first safe
text segment while the Connector is still receiving later agent deltas.

## Normal trace

```text
WakeDetected                       firmware local
turn.start                         device -> relay
turn.accepted                      relay -> device
audio frames                       device -> relay
turn.input_end                     device -> relay
ASR final                          relay internal
agent.run                          relay -> connector
agent.accepted                     connector -> relay
agent.text_delta *                 connector -> relay
TTS segment/audio *                relay internal
audio.start + audio frames         relay -> device
agent.done                         connector -> relay
audio.end                          relay -> device
turn.done                          relay -> device
```

## Cancellation

Cancellation is idempotent and propagates through every active stage:

```text
turn.cancel
  -> stop device capture/playback
  -> abort ASR
  -> agent.cancel -> ACP session/cancel
  -> abort TTS
  -> drop late events
  -> turn.done(cancelled)
```

## Permission wait

A permission request pauses the relevant agent operation but does not become
plain assistant text. It is identified by a unique request ID and expires. A
physical allow/deny result is accepted once; timeout and stale responses deny.

## Invariants

- one active turn per device connection
- one agent request per turn
- terminal state is final
- late events never reopen a terminal turn
- cancellation is safe to repeat
- unbounded buffering is forbidden
- uncertain side-effecting work is never automatically replayed
