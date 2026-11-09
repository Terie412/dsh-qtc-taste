# dsh-qtc-taste

A personal toolkit for DeepSeek Harness. **One plugin, several features**, each with its own page in Settings.

| Feature | Settings page | What it does |
|---|---|---|
| Personal prompt | Personalization | Your own preference blocks, injected into the system prompt of every model request |

## Feature: personal prompt

Write your own preferences into the system prompt.

- One master switch plus any number of preference blocks; each can be enabled, reordered, edited, and deleted on its own
- **Takes effect immediately**: the injected text is resolved at every assembly, so a saved edit applies to the next message without a restart
- **Verbatim injection**: your text is inserted literally. `{{ }}` is not treated as a prompt variable, so code snippets and templates cannot break assembly
- Lands at `order: 9800` — after tool guidance, before the deployment persona suffix (10200)

Stored at `<DSH_HOME>/storages/dsh-qtc-taste/taste.json`.

## Architecture

```
index.js                      composition: the FEATURES list, each register() called
src/host/storage.js           shared: document I/O (atomic writes), routes, Connection fence
src/host/features/
  personalization.js          feature: prompt section + its own route
client.js                     one settings page per feature + the shared controls
```

**Adding a feature is local work**: write a feature module, add one line to `FEATURES`, add one line to the Client's `PAGES`. No existing feature changes, and the profile's plugin count does not grow with the feature count.

Each feature owns:

- its own document (`storage.js` provides atomic writes and pure reads — a read during assembly never touches files)
- its own route (`registerFeatureRoute` standardizes the `{ ok, value }` envelope; method names never cross features, and another feature's method answers 404)
- its own contribution point

A feature that fails to register only logs; the rest of the toolkit stays online.

## Test

```
node test/host.mjs
```

Runs the real `index.js` and every feature module against a fabricated Cordis context: 42 checks covering section registration and order, document I/O and corruption recovery, limit truncation, route isolation, and the storage helpers.

## Considered and withdrawn

An "image anchors" feature — teaching the model which picture "图1" means — was removed in v0.3.0. It only reordered **the message the model receives** (`agent/pre-step`); the composer and the message bubble looked exactly the same. The expected result was images inlined into the text, which lives in `ui-conversation` and needs forking a shipped package. Waiting for upstream support.
