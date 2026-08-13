# Connector ports

The Connector application core depends on stable ports rather than concrete
agents. The first code phase will define `AgentRuntimePort`, `RelayClientPort`,
and `SessionBindingStore` here.

`AgentRuntimePort` represents exactly one configured runtime. It exposes session
open/resume, prompt event streaming, cancellation, permission resolution, health,
and close without exposing an agent product name or native protocol object.
