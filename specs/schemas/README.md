# Protocol schemas

JSON Schemas for Device Link v1 and Connector Link v1 will be added after the P0
compatibility spikes confirm the event and audio requirements. Once frozen in
P1, these schemas become the source of generated DTOs and conformance fixtures.

Schema-generated objects must be converted into domain types at adapter
boundaries rather than used directly throughout application cores.
