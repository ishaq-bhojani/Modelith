# Real-provider smoke test (run before every release)

Everything in the automated suite uses a **fake** provider, so the wire code
that only matters against a live API — SSE parsing, tool-call assembly, vision
blocks, failover — is exercised only by this manual pass. Run it against a real
build (`npm run dist:dir` → launch `release/*-unpacked/…`, or `npm run dev`)
with your own keys. Budget ~15 minutes.

Do it on at least **one hosted provider** (Anthropic or an OpenAI-compatible one)
and, if you use it, **Ollama** (local, no key). Repeat on each OS you ship to.

## Setup
- [ ] Settings → pick a provider, paste a real API key, **Save key** → status shows *Configured*.
- [ ] A model appears in the Model dropdown after the key is saved.
- [ ] (Ollama) with `ollama serve` running, its models list without a key.

## Core chat
- [ ] Send a prompt → reply **streams token by token** (not all at once).
- [ ] The model/provider badge and the **cost** under the reply are populated.
- [ ] **Stop** mid-stream leaves a partial reply marked *Stopped before completion*.
- [ ] Reload the app → the conversation is still there (persisted).
- [ ] Reasoning models (if any): thinking is handled without breaking the stream.

## Failover
- [ ] Configure a bogus primary key + a valid failover; send → it retries on the
      fallback and the badge shows the fallback model.

## Artifacts (canvas)
- [ ] Ask for an HTML page → it renders live in the canvas; edit request → new version.
- [ ] Ask for a mermaid diagram → renders (and matches light/dark theme).

## Vision (vision-capable provider)
- [ ] Attach a real screenshot, ask "what's in this image?" → the model describes it.
- [ ] A non-vision provider shows the "may not read images" note.

## Agentic edits (open a throwaway git repo as the workspace)
- [ ] Agent mode on → "create a file X" → **diff gate** shows the real diff.
- [ ] Accept → file written; **Revert** removes it.
- [ ] Reject → nothing written, no revert bar.
- [ ] "read file Y and summarise it" → read_file returns real content.

## Terminal + git
- [ ] Agent: "run the tests" → command gate shows the exact command; Run → real output streams.
- [ ] Git panel shows real branch/status/diff; a modified file shows a real diff.
- [ ] "commit with message …" → commit gate → the commit lands (check `git log`).

## MCP (one real server, e.g. a filesystem or fetch server)
- [ ] Add it in the Servers panel → status connects and its tools list.
- [ ] Agent calls one of its tools → confirm gate → real result returns.

## Model Race
- [ ] Race the same prompt across 2 real models → both columns stream; Pick one → it persists.

## Safety spot-checks
- [ ] Paste a real-looking key into the composer → the secret gate appears.
- [ ] Confirm the API key is **not** visible anywhere after saving (only "Configured").

Record the date, build/version, OS, and providers exercised in the release notes.
