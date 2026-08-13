# Contracts package

This package contains strict TypeBox DTO validators for Device Link and
Connector Link, branded domain IDs, stable errors, fixed PCM formats, and the
40-byte binary audio codec shared by both links.

Wire DTOs stop at adapter boundaries. Application cores convert them into stable
domain values rather than importing generated schema types everywhere.
