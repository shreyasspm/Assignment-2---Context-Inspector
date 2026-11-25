# Context Inspector (Assignment 2 prototype)

A browser prototype of the Context Inspector proposed in Assignment 1. It lets a user see what a coding assistant actually received in a long chat, spot a lost instruction, and repair it.

## Project status
**Works (implemented):**
- Chat with a scripted coding scenario (Flask shop app, 5 turns).
- Context compaction: when the simulated token budget is exceeded, older turns are replaced by a summary.
- Context Inspector panel: per-item state (Original, Summarized, Edited, Pinned, Restored, Excluded), provenance, token meter, and a flag for your sentences missing from a summary.
- Repair actions: pin a sentence, restore originals, edit, exclude, add a standing instruction, undo.
- Re-answer with updated context, with v1/v2 comparison and a "what changed in the context" line (it does not explain the model).
- Chat-to-Inspector link: summarised or excluded messages are marked in the chat, and the marker jumps to the item. A turn timeline strip shows where compaction happened.
- Two study conditions (Inspector on/off) and a JSON session log export.

**Simulated:** the assistant and the summariser. Both are rule-based (`core.js`). The summariser is deliberately lossy: it drops sentences phrased as standing instructions, which reproduces the failure described in Assignment 1. It is not evidence about any real product.

**Not built:** a real LLM connection, real tokenisation, user study, other task domains, causal "why this answer" explanations (the Inspector shows what was sent, not why).

## Technology stack
- Plain HTML, CSS and JavaScript. No framework, no build step, no network calls.
- `core.js`: context store, compactor, simulated assistant (runs in browser and Node). The assistant is a swappable adapter, `(contextItems, userText) => { text }`. It is synchronous for now; a real LLM would need `send` made async (planned).
- `app.js`, `index.html`, `style.css`: UI.
- `test/core.test.js`: Node tests (Node 18+, no dependencies).
- Undecided: which real LLM API to use if the simulator is replaced. A reviewer would supply their own key; none is stored here.

## Running or inspecting the work
```
git clone <your-repo-url> && cd context-inspector
# open index.html in a browser (double-click works), or:
python3 -m http.server 8000      # then visit http://localhost:8000
node test/core.test.js           # 15 tests
```
Follow the on-page Walkthrough. Screenshots of the key states are in `docs/screenshots/`.

## Development record
- **Core model:** separated what the user sees (full chat) from what the assistant receives (context items). Reason: the mismatch is the problem from Assignment 1. Checked with Node tests.
- **Lossy compaction:** added a summariser that drops instruction-style sentences, so the failure is reproducible on demand. Tuned the budget so compaction first happens on turn 5.
- **Inspector:** per-item state, provenance and a heuristic "not in summary" flag. Checked the flag catches the constraint sentence and not the app description.
- **Efficient repair:** added pin-one-sentence next to restore-all, because restoring everything costs tokens and re-triggers summarising. Restored, pinned and edited items are protected from re-summarising.
- **Control and recovery:** added undo, exclude and re-answer with v1/v2, after finding that an unnoticed change had no visible link to a new reply.
- **Chat/Inspector link and timeline:** marked affected chat messages and added a turn strip, because the two views were otherwise only connected implicitly. Checked the marker click focuses the right item.
- **Change summary and adapter:** v2 lists context changes (added/removed/edited) instead of implying a reason; the assistant became a swappable function, tested with a stub.
- **Honesty fix:** changed the over-budget meter from red (looked like an error) to amber with an explanation.

## AI assistance
Claude (Anthropic) helped write `core.js`, and the tests. The simulator's behaviour is my design decision, labelled as simulated here and in the app.

## Additional files
None. No API keys are used or needed.
