# Storage Migrations

## Versioned keys

- Video cues: `ytbm:cues:{videoId}`
- Global settings: `ytbm:global`

Each key stores `{ version, data }`.

## Versions

### v1 (legacy)
- Cues stored under `ytbm_cues_{videoId}` (plain cue map).
- Global mappings stored under `ytbm_mappings` (plain object).

### v2 (current)
- `{ version: 2, data: { cues, updatedAt } }` for cues.
- `{ version: 2, data: { midiMappings } }` for global settings.

## Migration behavior

- Reads validate shape and upgrade legacy values to the v2 schema.
- Invalid or corrupt data resets to defaults and records an error in session state.
