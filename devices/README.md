# Device implementations

Each child directory is an independent implementation of Device Link for one
device platform.

```text
devices/
  esp32/       ESP-IDF reference implementation
  linux/       future Linux reference implementation
  android/     future Android implementation
```

Only `esp32/` exists in v1. A new platform must implement the same versioned
Device Link contract and pass the shared conformance suite; it must not require
changes to Relay turn orchestration or Connector agent logic.

Platform and board metadata are diagnostic capabilities, not routing keys or
domain identities. `DeviceId` is an issued logical identity and must not be
defined as a MAC address, chip ID, GPIO layout, or board model.
