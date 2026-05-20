# Changelog

All notable changes to `n8n-nodes-sogni` are documented in this file.

The format is loosely [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project does not strictly follow Semantic Versioning yet (we land features under minor
bumps and fixes under patch).

## [1.7.0] — 2026-05-20

### Added

- **Audio resource** — generate music and audio with `Audio → Generate` and pre-flight
  estimates with `Audio → Estimate Cost`. Fields cover model picker (filtered to audio
  models with an ACE-Step / `audio`/`music` keyword fallback), prompt, network, duration,
  and a four-group additional-fields collection: *Music & Lyrics* (lyrics, language,
  BPM, time signature, key/scale, composer mode, prompt strength, creativity, shift,
  sampler, scheduler), *Generation Settings*, *Output* (download to binary + mp3/flac/wav),
  and *Advanced* (token type, timeout).
- **Creative Workflow resource** — drive the hosted Sogni creative workflows engine from
  n8n with five operations: `Start`, `Get`, `List`, `Get Events`, `Cancel`. `Start` supports
  both *Saved Template* mode (template ID + inputs JSON) and *Inline Plan* mode (full
  workflow JSON with `steps[]`). An optional `Wait Until Terminal` toggle polls until the
  run reaches a terminal status (`completed`, `partial_failure`, `failed`, `cancelled`,
  `waiting_for_user`) with configurable interval/timeout; off by default so existing
  workflows aren't accidentally blocked.
- **LLM hosted-tools toggle** — `LLM → Generate` gained an `Enable Sogni Hosted Tools`
  checkbox in *LLM Additional Fields* that exposes Sogni's hosted creative tool manifest
  (`SOGNI_HOSTED_TOOLS_MANIFEST` — 24 tools total: 18 generation tools `generate_image`,
  `generate_video`, `generate_music`, `edit_image`, `animate_photo`, `restore_photo`,
  `apply_style`, `change_angle`, `dance_montage`, `extend_video`, `orbit_video`,
  `overlay_video`, `refine_result`, `replace_video_segment`, `sound_to_video`,
  `stitch_video`, `video_to_video`, `add_subtitles`, plus 6 composition tools
  `enhance_prompt`, `compose_lyrics`, `compose_instrumental`, `compose_script`,
  `compose_workflow`, `compose_workflow_template`) without users having to author
  `Tools JSON` by hand. User-provided tools with the same name override hosted entries.
- **LLM → Estimate Cost** — pre-flight chat cost estimates via `estimateChatCost`. Reuses
  the same model/prompt/system fields as `Generate`.
- **Model → Get Most Popular** — convenience op that returns the model with the most
  active workers in a single round trip (driven by `getMostPopularModel`).
- **Top-level dynamic Size Preset for image generation** — new `Size Preset
  (Server-Validated)` dropdown on `Image → Generate` that calls `getSizePresets(network,
  modelId)` via loadOptions, so the available sizes always match what the chosen model
  accepts on the chosen network. Takes precedence over the legacy preset field in
  *Additional Fields → Output*, which remains for backward compatibility.

### Changed

- Bumped `@sogni-ai/sogni-intelligence-client` to `^2.3.0`, which pulls in
  `@sogni-ai/sogni-client@^5.0.0-alpha.11` and the latest protocol-backed hosted tool
  manifest.
- All n8n wrapper connections now pass `appSource: "n8n-nodes-sogni"` for server-side
  attribution via the new intelligence-client 2.3.0 wrapper config field.
- Hosted-tools UI copy now derives the tool-name list from `SOGNI_HOSTED_TOOLS_MANIFEST`
  instead of carrying a hand-maintained partial list.
- Updated development-only dependencies (`n8n-workflow`, `@typescript-eslint/parser`,
  and `@typescript-eslint/eslint-plugin`) to remove fixable audit findings while
  keeping `n8n-workflow` on the stable 2.20.x line.

### Internal

- Validation test suite extended from 36 → 58 cases.
- `dependencies`: now tracking `@sogni-ai/sogni-intelligence-client@^2.3.0`. New
  imports also use the `@sogni-ai/sogni-intelligence-client/openai-tools` subpath
  export for the hosted-tools manifest.

## [1.6.0]

- Bumped `@sogni-ai/sogni-intelligence-client` to `^2.2.8`.

## [1.5.7] and earlier

- See the GitHub release notes for prior history.
