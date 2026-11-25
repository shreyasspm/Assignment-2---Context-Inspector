/*
 * core.js — logic for the Context Inspector prototype (no DOM, no network).
 *
 * Three parts, kept separate so they can be tested in Node and swapped later:
 *   1. Context store   — what text is "sent" to the assistant, and each item's state
 *   2. Compactor       — a deliberately LOSSY summariser (simulates context compaction)
 *   3. SimAssistant    — a rule-based stand-in for an LLM. It reads only the context it is given.
 *
 * SIMULATION NOTE: the assistant and the compactor are scripted. They reproduce the failure
 * described in Assignment 1 (a standing instruction is lost after summarising); they are not
 * evidence about how any real product behaves.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BUDGET = 175; // simulated tokens

  // ---------- scripted scenario (coding assistant, Flask shop app) ----------
  const SCRIPT = [
    "I'm debugging my Flask shop app (app.py, models.py, routes.py). Never modify my current code architecture; fix bugs only.",
    'Login returns a 500 error when the email has capital letters.',
    "The cart total is wrong when an item's quantity is 0.",
    'Users are logged out right after they log in.',
    'Checkout is slow, about 3 seconds to load the order page.'
  ];

  // ---------- text helpers ----------
  const CONSTRAINT_RE = /(never|do not|don't|must not)\s+(modify|change|touch|alter)[^.;]*architecture|bugs? only/i;
  const INSTRUCTION_WORDS = /\b(never|don't|do not|must|always|only|keep|avoid)\b/i;
  const STOP = new Set('this that with from have when then they them there your what will into been were does done also just about after before while which where'.split(' '));

  const sentences = (t) => t.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const countTokens = (t) => Math.max(1, Math.round(t.trim().split(/\s+/).length * 1.3));
  const words = (s) => (s.toLowerCase().match(/[a-z0-9_]+/g) || []).filter((w) => w.length > 3 && !STOP.has(w));
  function labelOf(i) {
    if (i.kind === 'user') return `You \u00b7 turn ${i.turn}`;
    if (i.kind === 'assistant') return `Assistant \u00b7 turn ${i.turn}`;
    if (i.kind === 'summary') return i.turn === i.turnTo ? `Summary of turn ${i.turn}` : `Summary of turns ${i.turn}\u2013${i.turnTo}`;
    return 'Pinned instruction';
  }
  const fingerprint = (items) => items.map((i) => i.id + '\u0001' + i.text).join('\u0002');

  // ---------- 2. Compactor (lossy on purpose) ----------
  // Keeps task facts, drops sentences phrased as standing instructions. This models the
  // documented risk that summaries omit constraints; it is a design choice of the simulation.
  function summarize(srcs) {
    const turns = [...new Set(srcs.map((s) => s.turn))].sort((a, b) => a - b);
    const parts = [];
    for (const t of turns) {
      for (const m of srcs.filter((s) => s.turn === t)) {
        if (m.kind === 'user') {
          const keep = sentences(m.text).filter((s) => !INSTRUCTION_WORDS.test(s));
          if (keep.length) parts.push('User: ' + keep.join(' '));
        } else {
          const first = sentences(m.text)[0];
          if (first && !INSTRUCTION_WORDS.test(first)) parts.push('Assistant: ' + first);
        }
      }
    }
    const from = turns[0], to = turns[turns.length - 1];
    const label = from === to ? `turn ${from}` : `turns ${from}–${to}`;
    return { text: `Summary of ${label}. ` + parts.join(' '), from, to };
  }

  // ---------- 3. Simulated assistant ----------
  const TOPICS = [
    { id: 'perf', re: /slow|seconds|performance|latency/i,
      fix: 'The 3 s delay is an N+1 query in `checkout()`: each cart item triggers its own product lookup. Add `joinedload(Order.items)` to the existing query in routes.py. No structural change is needed.',
      refactor: 'The slowness is structural. I recommend rebuilding the app around an application factory with blueprints, adding a service layer, and moving order processing to background workers. I can draft the new project layout.' },
    { id: 'session', re: /logged out|session|expire|cookie/i,
      fix: 'The session cookie is not marked permanent, so it ends with the browser session. Set `session.permanent = True` after login and configure `PERMANENT_SESSION_LIFETIME`.',
      extra: 'I would also switch to server-side sessions in Redis and move configuration into an application factory.' },
    { id: 'login', re: /login|log in|email|sign.?in|password/i,
      fix: "That's a casing mismatch in routes.py: the lookup compares the raw email to lowercase stored values. Change it to `User.query.filter_by(email=email.lower())`, a one-line fix.",
      extra: 'While we are here, I would move all auth code into its own blueprint with a service layer so the casing logic lives in one place.' },
    { id: 'cart', re: /cart|quantity|total/i,
      fix: '`calculate_total()` in models.py divides by quantity before checking it. Add a guard: `if item.quantity == 0: continue`.',
      extra: 'Longer term, I would extract cart logic into a `CartService` class and remove business methods from the models.' }
  ];

  function simulateAssistant(ctx, userText) {
    const hit = ctx.find((i) => CONSTRAINT_RE.test(i.text));
    const constraintActive = !!hit;
    const topic = TOPICS.find((t) => t.re.test(userText));
    const rule = hit ? `Constraint found in context item "${hit.id}" (${hit.kind})` : 'No constraint found in context';
    let text, mode;
    if (!topic) {
      if (CONSTRAINT_RE.test(userText)) {
        text = "Got it, I'll keep to that and look at one bug at a time. Send me the first error.";
        mode = 'fix-only';
      } else if (constraintActive) {
        text = "I'll stay within your existing structure and focus on the bug itself. Could you paste the traceback or the function involved?";
        mode = 'fix-only';
      } else {
        text = 'Before fixing that, I would suggest reorganising the project into blueprints and a service layer. Could you paste the traceback or the function involved?';
        mode = 'refactor-suggested';
      }
    } else if (constraintActive) {
      text = topic.fix; mode = 'fix-only';
    } else if (topic.refactor) {
      text = topic.refactor; mode = 'refactor-suggested';
    } else {
      text = topic.fix + ' ' + topic.extra; mode = 'refactor-suggested';
    }
    return { text, mode, rule, fingerprint: fingerprint(ctx), used: ctx.map((i) => ({ id: i.id, text: i.text })), at: Date.now() };
  }

  function diffUsed(prev, next) {
    const p = new Map(prev.map((u) => [u.id, u])), n = new Map(next.map((u) => [u.id, u]));
    return {
      added: next.filter((u) => !p.has(u.id)).map((u) => u.label),
      removed: prev.filter((u) => !n.has(u.id)).map((u) => u.label),
      edited: next.filter((u) => p.has(u.id) && p.get(u.id).text !== u.text).map((u) => u.label)
    };
  }

  // ---------- 1. Context store / session ----------
  class Session {
    constructor(opts = {}) {
      this.budget = opts.budget || DEFAULT_BUDGET;
      // Adapter contract: (contextItems, userText) => { text, mode?, rule? }. Swap in a real LLM here (planned).
      this.assistant = opts.assistant || simulateAssistant;
      this.sumSeq = 0; this.pinSeq = 0;
      this.reset();
    }
    reset() {
      this.archive = {};   // every original message, never modified
      this.items = [];     // what the assistant receives (ordered)
      this.chat = [];      // what the user sees in the chat window (full transcript)
      this.turn = 0;
      this.undoStack = [];
      this.log = [];
      this.events = [];    // compaction events
    }

    // ----- reads -----
    effective() { return this.items.filter((i) => i.included); }
    tokens() { return this.effective().reduce((n, i) => n + countTokens(i.text), 0); }
    label(i) { return labelOf(i); }
    stateOf(i) { return i.included ? i.state : 'excluded'; }
    lastAssistant() { for (let k = this.chat.length - 1; k >= 0; k--) if (this.chat[k].role === 'assistant') return this.chat[k]; return null; }
    _ctxForReply(turn) { return this.effective().filter((i) => i.id !== 'a' + turn); }
    changedSinceReply() {
      const a = this.lastAssistant(); if (!a) return false;
      const v = a.versions[a.versions.length - 1];
      return fingerprint(this._ctxForReply(a.turn)) !== v.fingerprint;
    }
    changedIds() {
      const a = this.lastAssistant(); if (!a) return new Set();
      const used = new Map(a.versions[a.versions.length - 1].used.map((u) => [u.id, u.text]));
      return new Set(this._ctxForReply(a.turn).filter((i) => used.get(i.id) !== i.text).map((i) => i.id));
    }
    // Which of the user's own sentences are NOT carried into a summary (heuristic word overlap).
    droppedSentences(summary) {
      const have = new Set(words(summary.text));
      const out = [];
      for (const id of summary.sources) {
        const m = this.archive[id];
        sentences(m.text).forEach((s, idx) => {
          const w = words(s);
          const share = w.length ? w.filter((x) => have.has(x)).length / w.length : 1;
          out.push({ srcId: id, idx, sentence: s, kind: m.kind, dropped: m.kind === 'user' && share < 0.5 });
        });
      }
      return out;
    }
    // How a chat message is represented in the context the assistant receives.
    statusOfMessage(id) {
      const it = this.items.find((i) => i.id === id);
      if (it) return { state: this.stateOf(it), itemId: it.id };
      const sm = this.items.find((i) => i.kind === 'summary' && i.sources.includes(id));
      return sm ? { state: this.stateOf(sm) === 'excluded' ? 'excluded' : 'summarized', itemId: sm.id } : { state: 'original', itemId: null };
    }
    isPinned(text) { return this.items.some((i) => i.kind === 'pinned' && i.text === text); }

    // ----- conversation -----
    send(text) {
      text = text.trim(); if (!text) return null;
      const turn = ++this.turn;
      const u = { id: 'u' + turn, kind: 'user', turn, text };
      this.archive[u.id] = u;
      let compaction = null;
      if (this.tokens() + countTokens(text) > this.budget) compaction = this._compact(turn);
      this.items.push(this._mk(u));
      this.chat.push({ role: 'user', id: u.id, turn, text });
      const reply = this._ask(this.effective(), text);
      const a = { id: 'a' + turn, kind: 'assistant', turn, text: reply.text };
      this.archive[a.id] = a;
      this.items.push(this._mk(a));
      this.chat.push({ role: 'assistant', id: a.id, turn, versions: [reply], active: 0 });
      this._log('send', { turn, mode: reply.mode, compacted: !!compaction });
      return { reply, compaction };
    }
    reanswer() {
      const a = this.lastAssistant(); if (!a) return null;
      const user = this.chat.find((m) => m.role === 'user' && m.turn === a.turn);
      const reply = this._ask(this._ctxForReply(a.turn), user.text);
      reply.delta = diffUsed(a.versions[a.versions.length - 1].used, reply.used);
      a.versions.push(reply); a.active = a.versions.length - 1;
      const item = this.items.find((i) => i.id === 'a' + a.turn);
      if (item) item.text = reply.text;
      this._log('reanswer', { turn: a.turn, mode: reply.mode, version: a.versions.length });
      return reply;
    }

    // ----- inspector actions (all undoable) -----
    pinSentence(srcId, idx) {
      const s = sentences(this.archive[srcId].text)[idx];
      if (!s || this.isPinned(s)) return false;
      this._snap();
      const at = this.items.filter((i) => i.kind === 'pinned').length;
      this.items.splice(at, 0, { id: 'p' + (++this.pinSeq), kind: 'pinned', turn: this.archive[srcId].turn, text: s, state: 'pinned', base: 'pinned', included: true, protected: true, from: srcId });
      this._log('pin', { srcId, idx });
      return true;
    }
    addInstruction(text) {
      text = text.trim(); if (!text) return false;
      this._snap();
      const at = this.items.filter((i) => i.kind === 'pinned').length;
      this.items.splice(at, 0, { id: 'p' + (++this.pinSeq), kind: 'pinned', turn: this.turn, text, state: 'pinned', base: 'pinned', included: true, protected: true, typed: true });
      this._log('addInstruction', {});
      return true;
    }
    restoreSummary(id) {
      const k = this.items.findIndex((i) => i.id === id && i.kind === 'summary');
      if (k < 0) return false;
      this._snap();
      const back = this.items[k].sources.map((sid) => ({ ...this._mk(this.archive[sid]), state: 'restored', base: 'restored', protected: true }));
      this.items.splice(k, 1, ...back);
      this._log('restore', { id, n: back.length });
      return true;
    }
    editItem(id, text) {
      const it = this.items.find((i) => i.id === id); text = text.trim();
      if (!it || !text || text === it.text) return false;
      this._snap();
      if (it.originalText === undefined) it.originalText = it.text;
      it.text = text; it.state = 'edited'; it.protected = true;
      this._log('edit', { id });
      return true;
    }
    resetItem(id) {
      const it = this.items.find((i) => i.id === id);
      if (!it || it.originalText === undefined) return false;
      this._snap();
      it.text = it.originalText; delete it.originalText; it.state = it.base; if (it.base === 'original') it.protected = false;
      this._log('resetEdit', { id });
      return true;
    }
    toggleInclude(id) {
      const it = this.items.find((i) => i.id === id); if (!it) return false;
      this._snap(); it.included = !it.included;
      this._log(it.included ? 'include' : 'exclude', { id });
      return true;
    }
    undo() {
      const s = this.undoStack.pop(); if (!s) return false;
      this.items = JSON.parse(s); this._log('undo', {});
      return true;
    }

    // ----- internals -----
    _ask(ctx, userText) {
      const r = { ...this.assistant(ctx, userText) };
      r.mode = r.mode || 'unknown'; r.rule = r.rule || '';
      r.fingerprint = fingerprint(ctx);
      r.used = ctx.map((i) => ({ id: i.id, text: i.text, label: labelOf(i) }));
      r.at = Date.now();
      return r;
    }
    _mk(m) { return { id: m.id, kind: m.kind, turn: m.turn, text: m.text, state: 'original', base: 'original', included: true, protected: false }; }
    _snap() { this.undoStack.push(JSON.stringify(this.items)); if (this.undoStack.length > 50) this.undoStack.shift(); }
    _log(type, detail) { this.log.push({ t: new Date().toISOString(), type, ...detail }); }
    _compact(current) {
      const elig = this.items.filter((i) => i.included && !i.protected && i.kind !== 'pinned' && i.turn <= current - 2);
      if (!elig.length) return null;
      const before = this.tokens();
      const ids = [...new Set(elig.flatMap((i) => (i.kind === 'summary' ? i.sources : [i.id])))]
        .sort((x, y) => this.archive[x].turn - this.archive[y].turn || (x[0] === 'u' ? -1 : 1));
      const sm = summarize(ids.map((id) => this.archive[id]));
      const summary = { id: 's' + (++this.sumSeq), kind: 'summary', turn: sm.from, turnTo: sm.to, text: sm.text, state: 'summarized', base: 'summarized', included: true, protected: false, sources: ids };
      const out = []; let done = false;
      for (const i of this.items) {
        if (elig.includes(i)) { if (!done) { out.push(summary); done = true; } } else out.push(i);
      }
      this.items = out;
      const ev = { turns: [sm.from, sm.to], before, after: this.tokens(), summaryId: summary.id, atTurn: current };
      this.events.push(ev);
      this._log('compaction', ev);
      return ev;
    }
  }

  return { Session, SCRIPT, simulateAssistant, labelOf, DEFAULT_BUDGET, countTokens, sentences, CONSTRAINT_RE };
});
