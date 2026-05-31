<div align="center">
  <img src="static/logo-square.png" alt="ProofOS Logo" width="128" height="128">

# ProofOS

### AI Proofreader for Google Docs

[![Chrome](https://img.shields.io/badge/Chrome-120+-4285F4?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**A pluggable proofreading workbench that runs entirely against your own LLM, with grammar/punctuation/capitalization handled by a self-hosted LanguageTool and spelling by a local dictionary.**

[Run it locally](#run-it-locally) •
[How it works](#how-it-works) •
[Features](#features) •
[Configuration](#configuration) •
[Open issues](#open-issues) •
[Privacy](#privacy--security)

</div>

---

## What is ProofOS?

ProofOS is a Chrome extension that adds an LLM-powered proofreading workbench to **Google Docs**. It reads your document, dispatches every enabled rule to the engine best-suited for it (local dictionary, LanguageTool, or LLM), and shows every finding in the side panel with a one-click **Copy fix**.

The default install is end-to-end local: spelling via [nspell](https://github.com/wooorm/nspell) with an en-US dictionary, grammar/punctuation/capitalization/preposition via a self-hosted [LanguageTool](https://languagetool.org/) Docker container, and the remaining writing-quality rules via local [Ollama](https://ollama.com/) running [`qwen2.5:latest`](https://ollama.com/library/qwen2.5). Your document text never leaves the machine.

If you'd rather use a hosted model for the LLM step, switch the provider in **Settings** to any OpenAI-compatible endpoint (OpenAI, OpenRouter, LM Studio, Together, vLLM, your own gateway) and supply a key. LanguageTool and spelling stay local either way.

---

## Run it locally

Everything below is a one-time setup. After this, `npm run dev` brings the whole stack up.

### Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22+ | Vite / TypeScript / Vitest. Pin via the project's `.tool-versions` if you use asdf. |
| npm | bundled with Node | Install deps. |
| Docker | recent | Runs the LanguageTool container (`npm run dev` calls `docker compose up -d languagetool`). |
| Chrome | 120+ | Hosts the extension. |
| [Ollama](https://ollama.com/download) | recent | Default LLM backend. Skip if you'll only use a hosted OpenAI-compatible API. |

### 1. Clone, install, and start the dev stack

```bash
git clone https://github.com/<your-fork>/proofos.git
cd proofos
npm install
npm run dev
```

`npm run dev` does two things in order:

1. `docker compose up -d languagetool` — pulls `erikvl87/languagetool:latest` (first run downloads ~700 MB) and starts it on `http://localhost:8010`.
2. `vite` — builds the extension into `./dev/` and rebuilds on every save.

Other Docker scripts:

```bash
npm run lt:up        # start LanguageTool without Vite
npm run lt:down      # stop the LanguageTool container
npm run lt:logs      # tail container logs
```

### 2. Set up Ollama (default LLM backend)

```bash
ollama pull qwen2.5:latest
ollama serve         # auto-started by the menu-bar app on macOS
```

**Allow the extension origin** — Ollama's HTTP API enforces an origin allow-list. Requests from a Chrome extension carry `Origin: chrome-extension://<id>` and are 403'd by default. Permit them once:

```bash
# macOS (persists across reboots):
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
# Then quit the Ollama menu-bar app and reopen it.
```

For Linux or a terminal-launched daemon, set the env var before `ollama serve`:

```bash
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

Verify:

```bash
curl -i -H "Origin: chrome-extension://abc" http://localhost:11434/api/tags | head -1
# Expect: HTTP/1.1 200 OK
```

If you'd rather not wildcard, use the specific extension ID Chrome assigns to your unpacked load (visible on the ProofOS card at `chrome://extensions/`). Loading from `dev/` vs `dist/` produces different IDs, so the wildcard is easier during development.

### 3. Load the extension into Chrome

1. Open `chrome://extensions/`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `dev/` directory (or `dist/` after `npm run build`).

The ProofOS card appears in your toolbar. Pin it for one-click access.

### 4. First proofread

1. Open any Google Doc.
2. Click the ProofOS icon — the side panel opens. The header should read **Google Docs · _your-doc-title_**.
3. Go to **Settings** → **Test LLM connection** (expect green) and **Test LanguageTool connection** (expect green). If either is red, see Troubleshooting below.
4. Switch to **Issues** → **Proofread document**. The button changes to **Proofreading… (X/Y)** with a **Cancel** next to it. Sections appear progressively under their rule headers (Spelling first since nspell is instant, then LT-driven rules, then LLM-driven rules).
5. On any issue card, click **Copy fix**. The suggestion lands on your clipboard. The card shows _Copied — paste in your doc_, with the paragraph context visible so you can locate the snippet, then `Cmd/Ctrl+V` over it.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Test LLM connection` says **403** | `OLLAMA_ORIGINS` not set | Run the `launchctl setenv` step in §2, restart Ollama. |
| `Test LLM connection` says **Could not reach Ollama** | `ollama serve` not running | Start the Ollama app, or run `ollama serve` in a terminal. |
| `Test LLM connection` says **Model "..." is not pulled** | model missing | `ollama pull qwen2.5:latest` (or whatever you've set as Model). |
| `Test LanguageTool connection` says **Could not reach LanguageTool** | container down | `npm run lt:up`, wait ~10 s for JVM warmup, retry. |
| `Test LanguageTool connection` says **reachable, but en-US is not loaded** | older ProofOS build | Pull main and reload the extension — the check is fixed. |
| Side panel says **Document is empty** when running on a Docs URL | URL didn't include `/document/d/{id}` | Open an actual document; the start screen / home page isn't supported. |
| `Copy fix` doesn't paste anything | clipboard write failing silently | Reload the extension; the side-panel button now writes inside the gesture handler, but only if you're on a recent build. |
| `Cancel` doesn't stop the run for several seconds | older build | Reload — recent code emits an optimistic UI update and bails the worker pool on the signal. |

---

## How it works

### Three-engine dispatch

Each enabled rule is annotated with a `runner` so the proxy can pick the right engine:

| Rule | Runner | Implementation |
| --- | --- | --- |
| Spelling | **local** | `nspell` + en-US dictionary (`public/dict/`). Sub-millisecond per word. |
| Sentence length | **local** | Counts words per sentence, flags > 40. |
| Grammar, Punctuation, Capitalization, Preposition usage | **languagetool** | Single HTTP call per paragraph to `http://localhost:8010/v2/check`. LT category → ProofOS rule mapping in `services/languagetool/client.ts`. |
| Missing words, Clarity, Conciseness, Passive voice, Parallel structure | **llm** | One bundled call per paragraph to the configured provider. All enabled LLM rules go in the same prompt so the model can consolidate. |
| User-added custom rules | **llm** | Always LLM — they're free-form English. |

If the LanguageTool URL is blank or unreachable, LT-tagged rules transparently fall back to the LLM.

### Component map

```
Chrome tab on docs.google.com
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   ProofOS side panel (chrome-extension://<id>/src/sidepanel/index.html)  │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │ src/sidepanel/main.ts                                           │    │
│   │   Issues tab  ◀────── live progress + issues stream             │    │
│   │   Rules tab   ◀────── chrome.storage.local                      │    │
│   │   Settings    ◀────── chrome.storage.local                      │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                            ▲  ▼  chrome.runtime.sendMessage              │
│                            │                                             │
│   ┌───────────────────── service worker ─────────────────────────────┐   │
│   │ src/background/main.ts                                           │   │
│   │   ─ per-tab state (issues, pending requestId, AbortController)   │   │
│   │   ─ routes apply/cancel/test-connection messages                 │   │
│   │   ─ fetches docs.google.com/.../export?format=txt (cookies +     │   │
│   │     host_permissions bypass content-script CORS)                 │   │
│   │                                                                  │   │
│   │ src/background/llm-proxy.ts  ── runProofread / runHealthCheck    │   │
│   │   1. splitIntoParagraphs(text)                                   │   │
│   │   2. dispatch by rule.runner                                     │   │
│   │   3. emit ProofreadProgressMessage after every task              │   │
│   └──────────────────────────────────────────────────────────────────┘   │
│       │                  │                  │                            │
│       ▼                  ▼                  ▼                            │
│   local checkers     LanguageTool       LLM provider                     │
│   (in-SW JS)         localhost:8010     localhost:11434                  │
│   ─ spelling.ts      via Docker         (or hosted OpenAI-compatible)    │
│   ─ sentence-length                                                      │
│                                                                          │
│                            ▲                                             │
│                            │ chrome.tabs.sendMessage                     │
│                            │                                             │
│   ┌──────────────── content script (src/content/main.ts) ────────────┐   │
│   │ GoogleDocsAdapter (src/content/adapters/google-docs.ts)          │   │
│   │   ─ getText()      → asks SW to fetch /export?format=txt         │   │
│   │   ─ applyIssue()   → best-effort Find dialog open + locate       │   │
│   │   ─ matches() / waitForReady() / getDocumentTitle()              │   │
│   └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### One proofread, end to end

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐
│ user     │    │ side panel   │    │ service      │    │ engines    │
│          │    │              │    │ worker       │    │            │
└────┬─────┘    └──────┬───────┘    └──────┬───────┘    └─────┬──────┘
     │ click           │                   │                  │
     │ Proofread       │                   │                  │
     │────────────────▶│                   │                  │
     │                 │ loadRules()       │                  │
     │                 │ → enabledRules    │                  │
     │                 │ proofread-request │                  │
     │                 │──────────────────▶│                  │
     │                 │                   │ get-document-text│
     │                 │                   │ → content script │
     │                 │                   │   → SW fetch     │
     │                 │                   │     /export?...  │
     │                 │                   │   → full doc text│
     │                 │                   │                  │
     │                 │                   │ splitIntoParagraphs
     │                 │                   │                  │
     │                 │                   │ for each enabled rule:
     │                 │                   │   pick runner    │
     │                 │                   │                  │
     │                 │                   │ local: spelling  │
     │                 │                   │   per paragraph  │
     │                 │                   │──────────────────▶ nspell.ts
     │                 │                   │◀──── issues ─────┤
     │                 │ progress-msg      │                  │
     │                 │◀──────────────────│                  │
     │  Spelling fills │                   │                  │
     │  in section     │                   │                  │
     │                 │                   │ LT: paragraphs   │
     │                 │                   │   concurrency=2  │
     │                 │                   │──────────────────▶ POST /v2/check
     │                 │                   │◀── matches[] ────┤
     │                 │ progress-msg×N    │   map by category│
     │                 │◀──────────────────│                  │
     │  Grammar / etc. │                   │                  │
     │  fill in        │                   │                  │
     │                 │                   │ LLM: paragraphs  │
     │                 │                   │   concurrency=4  │
     │                 │                   │   ALL rules      │
     │                 │                   │   bundled        │
     │                 │                   │──────────────────▶ POST chat
     │                 │                   │◀── JSON ─────────┤
     │                 │                   │   strip <think>  │
     │                 │                   │   parse / dedupe │
     │                 │ progress-msg×N    │                  │
     │                 │◀──────────────────│                  │
     │  Clarity etc.   │                   │                  │
     │  fill in        │                   │                  │
     │                 │                   │ all done →       │
     │                 │ proofread-result  │                  │
     │                 │◀──────────────────│                  │
     │  busy=false     │                   │                  │
     │                 │                   │                  │
     │ click Copy fix  │                   │                  │
     │────────────────▶│                   │                  │
     │   clipboard.    │                   │                  │
     │   writeText() ★ │                   │                  │
     │                 │ apply-issue       │                  │
     │                 │──────────────────▶│                  │
     │                 │                   │──▶ content script
     │                 │                   │     adapter      │
     │                 │                   │     best-effort  │
     │                 │                   │     open Find ✗  │
     │                 │                   │     (often fails)│
     │ paste in doc    │                   │                  │
     │                 │                   │                  │
```

★ The clipboard write happens **synchronously inside the click handler** in the side panel — that's the only context where Chrome's user-activation flag is live. A content-script write after a message round-trip silently fails.

### Per-paragraph task generation

The proxy treats every line break as a paragraph boundary (matches Google Docs' txt export, which puts one paragraph per line):

```
splitIntoParagraphs(text)
  → [{ id: 'p1', text, offset }, { id: 'p2', text, offset }, ...]
```

Each paragraph gets a stable short id (`p1`, `p2`, …) so prompts can reference it. The LLM prompt template includes the **target** paragraph plus the **previous** and **next** for context (do-not-flag), with all enabled LLM rules listed in one go:

```
Apply these rules to the target paragraph. Each issue must reference exactly
one rule id (the most specific one that applies). Do not flag the same span
under multiple rules.

Rules:
- missing-words (Missing words, missing-words): ...
- clarity      (Clarity, clarity): ...
- ...

Previous paragraph (id: p4, context only, do not flag):
"""
Background and context.
"""

Target paragraph (id: p5, flag issues here):
"""
The committe found that a effective response is needed.
"""

Next paragraph (id: p6, context only, do not flag):
"""
We recommend the following actions.
"""

Return JSON now.
```

The model returns strict JSON `{ "issues": [{ ruleId, paragraphId, original, suggestion, explanation }] }`. `parser.ts` strips any `<think>` blocks (DeepSeek-R1), validates each issue, and uses `documentText.indexOf(original, searchStart, searchEnd)` to resolve offsets into the full document — `searchStart` / `searchEnd` are pinned to the target paragraph's byte range so identical phrases elsewhere don't get mis-located.

The proxy deduplicates emitted issues by `(startIndex, endIndex, suggestion)` so the same span flagged with the same fix by two engines (e.g. an LT match overlapping an LLM suggestion) only shows once.

### Read path: Google Docs export endpoint

The visible text in Google Docs is rendered to a canvas — there's no DOM tree to walk. Instead:

1. The content script extracts the doc ID from the URL (`/document/d/{id}` or `/document/u/N/d/{id}`).
2. It asks the service worker to fetch `https://docs.google.com/document/d/{id}/export?format=txt` with `credentials: 'include'`.
3. The service worker holds `host_permissions` for `docs.google.com` and `*.googleusercontent.com` (the CDN host the export redirects to), so the request goes through with the user's session cookies and bypasses Google Docs' own service-worker interception of page-context fetches.
4. The response is the document as plain text, one paragraph per line.

### Apply path: clipboard write + best-effort locate

Direct programmatic edits to the canvas-rendered doc don't work (see [Open issues](#open-issues)). Instead:

1. Click **Copy fix** in the side panel.
2. The side panel runs `navigator.clipboard.writeText(issue.suggestion)` **synchronously** in the click handler. This succeeds because the click is a live user gesture.
3. The side panel also sends `proofos:apply-issue` to the service worker, which forwards it to the content script.
4. The content script's `GoogleDocsAdapter.applyIssue` does a **best-effort** `dispatchEvent` of `Ctrl/Cmd+F` on Docs' hidden input frame, then writes the snippet into the Find dialog input and presses Enter. When this works, the doc scrolls to the match; when Kix rejects the synthetic event (frequently), it silently no-ops.
5. The user pastes (`Cmd/Ctrl+V`) over the highlighted text — or finds the snippet visually using the paragraph context shown on the issue card, with the original wrapped in `<mark>`.

---

## Features

- **Reads your live Google Doc** via the Docs export endpoint — no canvas hacks, no add-in install, no OAuth.
- **Only injects on `docs.google.com`.** Nothing else.
- **Three-engine dispatch** picks the best tool per rule (local nspell, LanguageTool, or LLM).
- **Per-paragraph progressive run** — first findings appear in seconds; you can act on them while the rest of the document is still being scanned.
- **Pluggable LLM backend** — default local Ollama with `qwen2.5:latest`; switch to any OpenAI-compatible endpoint in Settings.
- **Editable rule set** — toggle defaults on/off and add custom rules in plain English from the Rules tab.
- **Side-panel workbench** — Issues / Rules / Settings tabs. Issues group under collapsible rule headers with before/after diffs, paragraph context, and one-click Copy fix.
- **Cancel anywhere** — abort in flight runs from the toolbar; takes effect immediately.

---

## Configuration

All settings live in the side-panel **Settings** tab and persist via `chrome.storage.local`.

| Setting | Default | Notes |
| --- | --- | --- |
| Provider | Ollama | Or OpenAI-compatible. |
| Base URL | `http://localhost:11434` | Any reachable host. The service worker holds the relevant `host_permissions`. |
| Model | `qwen2.5:latest` | Anything the provider recognises. Pull it with `ollama pull <model>` for Ollama. |
| API key | _(empty)_ | Only used when provider is OpenAI-compatible. |
| Temperature | `0.2` | Lower = stricter. |
| Max output tokens | `4096` | Reasoning models (DeepSeek-R1, etc.) need more headroom. |
| LanguageTool URL | `http://localhost:8010` | Matches the bundled `docker-compose.yml`. Blank disables LT and forces grammar-class rules onto the LLM. |

---

## Open issues

### Directly editing the Google Doc from the extension is unreliable

ProofOS cannot programmatically apply a fix into your Google Doc. The visible text in Docs is rendered to a canvas by the Kix editor, and Kix only accepts keyboard events with `isTrusted: true`. Synthetic events dispatched from a content script all carry `isTrusted: false` and are silently dropped — so calling `dispatchEvent(new KeyboardEvent(...))` does nothing.

**Today's workaround**: every issue card has a **Copy fix** button that copies the suggested replacement to your clipboard and best-effort opens the Docs Find dialog with the matching snippet pre-filled. You then paste over the highlight.

**Possible future fix** (not yet implemented): an opt-in **Auto-apply** toggle in Settings backed by Chrome's `chrome.debugger` API, which sends real `Input.dispatchKeyEvent` calls that Kix _does_ accept. Trade-offs:

- Chrome shows the yellow "ProofOS is debugging this browser" banner whenever the extension is attached.
- `chrome.debugger` either needs to be a declared permission (heavy install warning) or requested via `optional_permissions` per session.
- The debugger session can interfere with you opening DevTools on the same tab.

If you want this badly enough to accept those trade-offs, file an issue or PR.

---

## Development

### Daily workflow

```bash
npm install          # once
npm run dev          # docker compose up languagetool + vite watcher
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest (unit only)
npm run format       # prettier write
npm run format:check # prettier verify
npm run build        # tsc + vite build → dist/
```

For SW / content-script changes you'll usually need to click **↻ Reload** on the ProofOS card at `chrome://extensions/` (Vite's HMR can't reach the SW). Side-panel changes pick up on panel reopen.

### Project layout

```
src/
  background/
    main.ts            # service worker entry, per-tab state, message routing
    llm-proxy.ts       # runProofread + runHealthCheck (three-engine dispatch)
  content/
    main.ts            # content script entry
    doc-controller.ts  # picks the right adapter, message bridge
    adapters/
      adapter.ts       # DocumentAdapter interface + waitFor helper
      google-docs.ts   # Docs adapter (read via export, apply via clipboard)
  services/
    checks/            # local in-SW checkers + registry
      spelling.ts
      sentence-length.ts
      registry.ts
    languagetool/
      client.ts        # POST /v2/check, category → rule mapping, healthCheck
    llm/
      provider.ts      # interface + factory
      ollama.ts        # Ollama-specific client
      openai.ts        # OpenAI-compatible client
      prompts.ts       # system prompt + per-paragraph user prompt
      parser.ts        # <think> stripping + JSON parsing + offset resolution
      paragraphs.ts    # splitIntoParagraphs (one line per paragraph)
  shared/
    rules/             # Rule type, defaults, store (load/save custom rules)
    messages/issues.ts # ProofosMessage union (typed runtime messages)
    utils/storage.ts   # typed chrome.storage wrapper
    constants.ts       # STORAGE_KEYS + DEFAULT_LLM_SETTINGS
    types.ts           # ProofreadIssue, LlmSettings, ...
  sidepanel/
    index.html
    main.ts            # bootstrap + Issues/Rules/Settings tab wiring
    style.css
    components/
      issues-tab.ts
      rules-tab.ts
      settings-tab.ts
public/
  dict/                # nspell en-US dictionary (vendored from dictionary-en)
```

See [AGENTS.md](./AGENTS.md) for the full conventions (logging, naming, dependency injection, testing).

---

## Privacy & Security

- ProofOS only injects content scripts on `docs.google.com`. It cannot read other pages.
- Document text travels to whichever endpoint you configure:
  - **Default**: localhost Ollama + localhost LanguageTool — text never leaves your machine.
  - **Hosted LLM**: text goes to the OpenAI-compatible base URL you supplied.
- Spelling runs entirely in the extension service worker via a bundled en-US dictionary; no network.
- No telemetry, no analytics, no third-party scripts.
- Settings, custom rules, and the enabled-rule map persist in `chrome.storage.local` (this machine only).

See [PRIVACY.md](./PRIVACY.md) for the full policy.

---

## Contributing

Issues and pull requests welcome. Before opening a PR:

```bash
npm run typecheck && npm run lint && npm run test
```

The en-US spelling dictionary is vendored into `public/dict/` from the [`dictionary-en`](https://www.npmjs.com/package/dictionary-en) npm package — refresh it with `cp node_modules/dictionary-en/index.aff public/dict/en-US.aff && cp node_modules/dictionary-en/index.dic public/dict/en-US.dic` after `npm install`. Conventions (TypeScript style, logging, naming, dependency injection) are documented in [AGENTS.md](./AGENTS.md).
