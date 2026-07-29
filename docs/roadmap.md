# Roadmap

## What we're building toward

Open Coder is the only agent desktop that is **provider-agnostic by construction** and
**renders what it builds**. That combination is the whole strategy:

- Tools built around a single vendor relationship cannot do multi-model well, because
  their architecture assumes one provider.
- Desktop chat apps can talk about your code but cannot touch it.
- Visual builders are locked to one framework.

Everything below either widens that gap or is table stakes we cannot ship without. When
you are deciding what to work on, prefer the former.

## How to read the tiers

| Tier | Meaning |
|---|---|
| **P0** | Required before pre-production. Without these the product has no identity. |
| **P1** | The months after launch — what turns a curious user into a daily one. |
| **P2** | Valuable, not urgent. Good contributor territory. |

Nothing here is claimed by anyone unless an issue says so. If a P1 or P2 item is the
reason you'd contribute, take it — say so in an issue first so we don't duplicate work.

---

## A. Multi-model superpowers

The moat. These are the features a single-vendor tool structurally cannot copy.

1. **Model Race** — `P0`
   Send one prompt to 2–4 models at once; responses stream in parallel columns; pick the
   winner and the thread continues from it. Also the clearest 20-second demonstration of
   why this project exists.

2. **Mid-conversation model switching** — `P0`
   Swap models at any turn without losing context, with a per-message badge showing which
   model produced which reply.

3. **Retroactive replay** — `P1`
   Re-run any past message on a different model and diff the answers. Turns your own
   history into a permanent benchmark.

4. **Routing rules and privacy fences** — `P1`
   Declarative policies: short prompts to a local model, anything matching a secret
   pattern never leaves the machine, escalate to a frontier model when the local one
   hedges.

5. **Live cost meter** — `P0`
   Real currency per message, per session, per day, per provider, with an optional monthly
   budget. Bring-your-own-key users feel every token and no comparable tool shows this
   properly.

6. **Failover chains** — `P1`
   Rate-limited or 5xx on one provider, retry visibly on the next. Rate limits are the
   most common daily annoyance in this category.

7. **Model report card** — `P2`
   Which model's answers you actually kept, average cost, average latency, tokens burned.
   Only a multi-provider app can produce this.

## B. The artifact canvas

The promise in the tagline. Specified in §6 of
[the design spec](superpowers/specs/2026-07-29-agent-desktop-design.md).

8. **Live artifact canvas** — `P0`
   HTML, SVG, Mermaid and JSX rendering as it streams, in a sandboxed frame with no
   network egress by default.

9. **Point-and-refine** — `P0`
   Click a rendered element, describe the change, the agent edits that part. Deliberately
   avoids full DOM-to-source mapping: the selected element's markup goes into the prompt.

10. **Version scrubber** — `P1`
    Every artifact revision retained; scrub through history, diff two versions, restore
    one.

11. **Responsive and theme preview** — `P1`
    Viewport presets and a light/dark toggle inside the canvas.

12. **Multi-artifact tabs** — `P1`
    One conversation accumulates several artifacts; tab between them, pin the good ones.

13. **Export and eject** — `P1`
    Save as `.html`/`.svg`/`.png`, copy to clipboard, or write straight into a project
    folder.

## C. Agent capability

The line between a chat app and a coding tool.

14. **Workspace attach** — `P0`
    Point at a folder; the agent can read it.

15. **Diff-approve-edit gate** — `P0`
    Every write shows a diff you accept, reject, or hand-edit before it touches disk.

16. **Checkpoints and rollback** — `P1`
    Snapshot before each agent action, one-click restore. This is what makes people brave
    enough to let an agent write at all.

17. **MCP client and server browser** — `P1`
    The Model Context Protocol tool ecosystem, plus a UI to discover and install servers
    instead of hand-editing JSON.

18. **Terminal with allowlist** — `P1`
    Run commands, stream output back into context, approve per command with remembered
    allowlists.

19. **Git awareness** — `P2`
    Branch, diff, staged hunks, generated commit messages.

## D. Conversation craft

Where daily affection is won or lost.

20. **Branching conversations** — `P1`
    Fork from any message, explore two directions, compare them.

21. **Side threads** — `P1`
    Ask a clarifying question in a side panel that does not pollute the main context.

22. **Edit any message, including the assistant's** — `P2`
    Put words in its mouth and continue.

23. **Context inspector** — `P0`
    Show exactly what is being sent: which messages, token counts, what was trimmed.
    `applyContextBudget` already returns `omittedCount` and nothing renders it.

24. **Modes** — `P1`
    Named presets bundling system prompt, model, temperature and enabled tools.

25. **Prompt library** — `P2`
    Saved prompts with variables, inserted by slash command.

26. **Local semantic search over history** — `P2`
    Embeddings computed locally and never leaving the machine.

27. **Session organization** — `P0`
    Folders, tags, pin, archive, rename, search. Table stakes, and painful by session 30.

## E. Trust

Our advantage as an open-source, local-capable tool. These are features, not the absence
of features.

28. **Outbound secret scanning** — `P0`
    Detect API keys, `.env` contents and credentials in outgoing prompts; warn or redact
    before send.

29. **Provider data-policy badges** — `P1`
    Show plainly whether the selected provider trains on your inputs.

30. **Zero telemetry, verifiably** — `P0`
    No phone-home by default, with the network layer structured so anyone can audit it in
    a few minutes.

## F. Desktop-native

31. **Global hotkey quick-ask** — `P1`
    A floating window summoned from anywhere. The strongest argument for installing a
    desktop app rather than opening a tab.

32. **Command palette** — `P1`
    Keyboard-first access to everything.

33. **Attachments** — `P0`
    Images for vision models, PDFs, code files, and paste-a-screenshot.

---

## What we will not build

Stated so nobody spends a weekend on a pull request we would decline.

- **Inline autocomplete.** That is Copilot's game on Copilot's turf, and it needs an
  editor we deliberately do not have.
- **An IDE fork.** The maintenance burden is enormous and it means competing on someone
  else's terms.
- **Accounts, cloud sync, or a hosted backend.** The moment we hold user data we inherit
  the trust problem this project is built on not having. Sync through the user's own git
  repository or filesystem instead.
- **Chat-with-your-docs RAG.** Everyone ships one; nobody loves one.

## Sequencing opinions

Two calls worth arguing about rather than drifting into:

**Ship Model Race in the first public build**, even though it is not strictly required for
a usable product. It is the feature people screenshot, and screenshots are how
open-source projects spread.

**Ship the context inspector early.** "I can see exactly what you are sending" converts
skeptics faster than any feature that adds capability.
