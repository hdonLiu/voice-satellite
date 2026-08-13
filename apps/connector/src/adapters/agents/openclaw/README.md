# OpenClaw AgentRuntime adapter

OpenClaw is the first implementation of Connector's `AgentRuntimePort`.

The adapter will:

- supervise `openclaw acp` as a local stdio child process
- negotiate ACP capabilities
- map logical conversations to locally authorized OpenClaw sessions
- convert prompt, streaming update, cancellation, permission, and terminal events
- filter thoughts, secrets, local paths, raw tool I/O, and unknown events
- fail current work without replay when ACP state becomes uncertain

OpenClaw credentials, Gateway URLs, session keys, ACP JSON-RPC, and process
details remain inside this directory. Relay and Device Link never import them.
