# Decisions

- Development can run without MongoDB or a Gemini key: cases use an in-memory store and a deterministic fictional mystery fallback. Gemini text generation is enabled when its key and model are configured.
- The initial scaffold keeps the core account and case flow usable locally, while guest identity is stored in a signed, httpOnly cookie.
