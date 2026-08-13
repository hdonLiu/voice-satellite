# Security policy

## Supported versions

There is no supported release yet. Security fixes will initially target the
latest development branch and the newest published minor release after v1.0.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability involving credentials,
remote code execution, session isolation, firmware update signing, or private
audio/transcript leakage. Use GitHub's private vulnerability reporting feature
for this repository when available.

Include the affected component, reproduction steps, impact, and whether the
finding has been tested against a public instance. Do not access other users'
devices, audio, agents, or accounts while testing.

## Security boundaries

- The public Relay must never receive an OpenClaw Gateway credential.
- The Connector accepts only a narrow, validated command protocol; it is not an
  arbitrary HTTP, ACP, shell, or session-key proxy.
- The OpenClaw Gateway remains bound to localhost on the Connector host.
- Device and Connector credentials use separate scopes and are never sent in a
  URL query string.
- Raw audio and transcripts are not persisted by default.
- Agent requests accepted before an uncertain disconnect are not replayed.
- Sensitive tool actions require an approval path outside untrusted voice input.

The detailed threat model will be added before the first release candidate.
