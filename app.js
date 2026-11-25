/* app.js — UI for the Context Inspector prototype. All logic lives in core.js. */
(function () {
  'use strict';
  const { Session, SCRIPT } = Core;
  let S = new Session();
  const ui = { inspector: true, expanded: new Set(), editing: null, adding: false, scriptIdx: 0, notice: null };

  const $ = (id) => document.getElementById(id);
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
  const say = (m) => { $('status').textContent = m; };
  const tok = (t) => Core.countTokens(t);
  const STATE_LABEL = { original: 'Original', summarized: 'Summarized', edited: 'Edited', pinned: 'Pinned', restored: 'Restored original', excluded: 'Excluded' };

  // ---------------- chat ----------------
  function renderChat() {
    const el = $('chat');
    if (!S.chat.length) {
      el.innerHTML = '<p class="empty">Start with the scripted messages. The assistant is simulated, so no API key is needed.</p>';
      return;
    }
    const last = S.lastAssistant();
    el.innerHTML = S.chat.map((m) => {
      const st = ui.inspector ? S.statusOfMessage(m.id) : { state: 'original' };
      const badge = st.state === 'summarized' || st.state === 'excluded' || st.state === 'edited' || st.state === 'restored'
        ? `<button class="badge b-${st.state}" data-act="focusItem" data-id="${st.itemId}" title="Show in Inspector">${st.state === 'summarized' ? 'Summarised in context' : st.state === 'excluded' ? 'Excluded from context' : st.state === 'edited' ? 'Edited in context' : 'Restored'} \u2192</button>` : '';
      const cls = st.state === 'summarized' || st.state === 'excluded' ? ' is-' + st.state : '';
      if (m.role === 'user') return `<div class="msg user${cls}">${fmt(m.text)}${badge}</div>`;
      const v = m.versions[m.active];
      const tabs = m.versions.length > 1
        ? `<span class="vtabs" role="group" aria-label="Reply versions">${m.versions.map((_, k) =>
            `<button class="small" data-act="ver" data-id="${m.id}" data-k="${k}" aria-pressed="${k === m.active}">v${k + 1}</button>`).join(' ')}</span>` : '';
      const d = v.delta;
      const delta = ui.inspector && d && (d.added.length || d.removed.length || d.edited.length)
        ? `<div class="delta"><b>What changed in the context since v${m.active}:</b>` +
          (d.added.length ? ` added ${esc(d.added.join(', '))};` : '') + (d.removed.length ? ` removed ${esc(d.removed.join(', '))};` : '') +
          (d.edited.length ? ` edited ${esc(d.edited.join(', '))};` : '') + ' <i>(not a model explanation)</i></div>' : '';
      const meta = (tabs || (ui.inspector && m.versions.length > 1))
        ? `<div class="meta">${tabs}${ui.inspector ? `<span>${v.used.length} context items used</span>` : ''}</div>${delta}` : '';
      return `<div class="msg assistant${cls}">${fmt(v.text)}${badge}${meta}</div>` +
        (ui.inspector && m === last && S.changedSinceReply()
          ? `<div class="reanswer-bar">Context changed since this reply. <button class="small" data-act="reanswer">Re-answer</button></div>` : '');
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  // ---------------- inspector ----------------
  function renderItem(it) {
    const st = S.stateOf(it);
    const changed = S.lastAssistant() && S.changedIds().has(it.id);
    const long = it.text.length > 150;
    const open = ui.expanded.has('t:' + it.id);
    let prov = '';
    if (it.kind === 'user') prov = 'Your message, sent as written';
    else if (it.kind === 'assistant') prov = 'Assistant reply';
    else if (it.kind === 'summary') prov = `System-generated from ${it.sources.length} messages. Not your words.`;
    else prov = it.typed ? 'Typed by you in the Inspector' : `Pinned from your turn ${it.turn}`;
    if (st === 'restored') prov = 'Restored original. Protected from summarising.';
    if (it.protected && st === 'edited') prov += ' Protected from summarising.';

    let body = '';
    if (ui.editing === it.id) {
      body = `<div class="edit"><textarea id="editBox" aria-label="Edit context item">${esc(it.text)}</textarea>
        <div class="actions"><button class="small primary" data-act="saveEdit" data-id="${it.id}">Save</button>
        <button class="small" data-act="cancelEdit">Cancel</button></div></div>`;
    } else {
      body = `<p class="text ${long && !open ? 'clamp' : ''}">${fmt(it.text)}</p>`;
    }

    let flags = '';
    let originals = '';
    if (it.kind === 'summary') {
      const dropped = S.droppedSentences(it).filter((d) => d.dropped && !S.isPinned(d.sentence));
      flags = dropped.map((d) => `<div class="flag">Not in this summary: &ldquo;${esc(d.sentence)}&rdquo;
        <div class="actions"><button class="small primary" data-act="pin" data-src="${d.srcId}" data-idx="${d.idx}">Pin this sentence</button></div></div>`).join('');
      if (ui.expanded.has('o:' + it.id)) {
        originals = '<div class="originals">' + it.sources.map((sid) => {
          const m = S.archive[sid];
          const ds = S.droppedSentences(it).filter((d) => d.srcId === sid);
          return `<div class="orig-msg"><div class="who">${m.kind === 'user' ? 'You' : 'Assistant'} · turn ${m.turn} (original)</div>` +
            ds.map((d) => `<div class="sent ${d.dropped && !S.isPinned(d.sentence) ? 'dropped' : ''}"><span class="s">${fmt(d.sentence)}${d.dropped && !S.isPinned(d.sentence) ? '<span class="mark">not found in summary (heuristic check)</span>' : ''}</span>` +
              (m.kind === 'user' ? (S.isPinned(d.sentence) ? '<span class="chip pinned">Pinned</span>' : `<button class="small" data-act="pin" data-src="${sid}" data-idx="${d.idx}">Pin</button>`) : '') + '</div>').join('') + '</div>';
        }).join('') + '</div>';
      }
    }

    const actions = ui.editing === it.id ? '' : `<div class="actions">
      ${it.kind === 'summary' ? `<button class="small" data-act="toggleOrig" data-id="${it.id}" aria-expanded="${ui.expanded.has('o:' + it.id)}">${ui.expanded.has('o:' + it.id) ? 'Hide' : 'Show'} originals</button>
        <button class="small" data-act="restore" data-id="${it.id}" title="Replace the summary with the original messages">Restore originals (+${Math.max(0, it.sources.reduce((n, s) => n + tok(S.archive[s].text), 0) - tok(it.text))} tok)</button>` : ''}
      ${long ? `<button class="small" data-act="toggleText" data-id="${it.id}">${open ? 'Less' : 'More'}</button>` : ''}
      <button class="small" data-act="edit" data-id="${it.id}">Edit</button>
      ${it.originalText !== undefined ? `<button class="small" data-act="resetEdit" data-id="${it.id}">Reset edit</button>` : ''}
      <button class="small" data-act="toggleInclude" data-id="${it.id}">${it.included ? 'Exclude' : 'Include'}</button></div>`;

    return `<li class="item s-${st}" id="item-${it.id}"><div class="item-head"><span class="who">${S.label(it)}</span>
      <span class="chip ${st}">${STATE_LABEL[st]}</span>${changed ? '<span class="chip changed">New since last reply</span>' : ''}
      <span class="tok">${it.included ? tok(it.text) : 0} tok</span></div>
      <div class="prov">${prov}</div>${body}${flags}${originals}${actions}</li>`;
  }

  function renderInspector() {
    const el = $('inspector');
    const used = S.tokens(), pct = Math.min(100, Math.round((used / S.budget) * 100));
    const over = used > S.budget; // not an error: the next message triggers summarising
    const summaries = S.items.filter((i) => i.kind === 'summary' && i.included).length;
    $('toggleInspector').parentElement.title = summaries ? `${summaries} summarised item(s) in context` : 'Context Inspector';

    const banners = [];
    if (ui.notice) banners.push(`<div class="banner info"><b>Context was compacted.</b> ${esc(ui.notice)}</div>`);
    if (S.changedSinceReply()) banners.push(`<div class="banner warn">You changed the context after the last reply.<div class="row"><span>Re-answer to use the updated context.</span><button class="small primary" data-act="reanswer">Re-answer</button></div></div>`);

    const add = ui.adding ? `<div class="banner ok"><textarea id="addBox" rows="2" placeholder="e.g. Never modify my current code architecture; fix bugs only." aria-label="Standing instruction"></textarea>
      <div class="actions"><button class="small primary" data-act="saveAdd">Add instruction</button><button class="small" data-act="cancelAdd">Cancel</button></div></div>` : '';

    const cells = [];
    for (let t = 1; t <= S.turn; t++) {
      const u = S.statusOfMessage('u' + t), r = S.statusOfMessage('a' + t);
      const worst = [u.state, r.state].includes('excluded') ? 'excluded' : [u.state, r.state].includes('summarized') ? 'summarized' : [u.state, r.state].includes('edited') ? 'edited' : [u.state, r.state].includes('restored') ? 'restored' : 'original';
      const target = u.itemId || r.itemId;
      cells.push(`<button class="tl t-${worst}" ${target ? `data-act="focusItem" data-id="${target}"` : 'disabled'} title="Turn ${t}: ${STATE_LABEL[worst]}">${t}</button>`);
    }
    const timeline = cells.length ? `<div class="timeline" aria-label="Turns and how they reach the assistant">${cells.join('')}<span class="tl-key">turn: <i class="k-original"></i>as written <i class="k-summarized"></i>summarised</span></div>` : '';
    el.innerHTML = `<div class="insp-head"><h2>Context sent to the assistant</h2>
      <p class="note">This is the text the assistant receives, top to bottom. It shows <i>what</i> was sent, not <i>why</i> the assistant answered as it did.</p>
      <div class="meter ${over ? 'over' : ''}" role="img" aria-label="Context used ${used} of ${S.budget} simulated tokens"><i style="width:${pct}%"></i></div>
      <div class="meter-label"><span>${used} / ${S.budget} simulated tokens${over ? ' \u00b7 older turns are summarised on your next message' : ''}</span><span>${S.effective().length} items</span></div>
      ${timeline}<div class="toolbar"><button class="small" data-act="undo" ${S.undoStack.length ? '' : 'disabled'}>Undo</button>
      <button class="small" data-act="startAdd">+ Add standing instruction</button></div></div>
      ${banners.join('')}${add}
      ${S.items.length ? `<ul class="items">${S.items.map(renderItem).join('')}</ul>` : '<p class="note" style="padding:14px">Nothing sent yet. Send a message to see what the assistant receives.</p>'}
      <details class="log"><summary>Activity log (${S.log.length})</summary><ol>${S.log.slice(-8).map((e) => `<li>${esc(e.type)}${e.turn ? ' (turn ' + e.turn + ')' : ''}</li>`).join('')}</ol></details>`;
    if (ui.editing && $('editBox')) $('editBox').focus();
  }

  function renderScript() {
    const el = $('scriptRow');
    el.innerHTML = ui.scriptIdx < SCRIPT.length
      ? `<span>Scripted message ${ui.scriptIdx + 1} of ${SCRIPT.length}</span><button type="button" class="small" data-act="useScript">Use next scripted message</button>`
      : '<span>Script finished. Try your own: mention <code>cart</code>, <code>login</code>, <code>session</code> or <code>slow</code>.</span>';
  }

  function renderDebug() {
    const rows = S.chat.filter((m) => m.role === 'assistant').map((m) => {
      const v = m.versions[m.active];
      return `turn ${m.turn} v${m.active + 1}: mode=${v.mode}\n   rule: ${v.rule}`;
    });
    $('debug').textContent = rows.length ? rows.join('\n') : 'No replies yet.';
  }

  function render() {
    $('badge') && $('badge').remove();
    document.querySelector('main').classList.toggle('no-inspector', !ui.inspector);
    renderChat(); renderInspector(); renderScript(); renderDebug();
  }

  // ---------------- events ----------------
  function send() {
    const box = $('input'); const text = box.value.trim();
    if (!text) return;
    ui.notice = null;
    const r = S.send(text);
    if (text === SCRIPT[ui.scriptIdx]) ui.scriptIdx++;
    if (r.compaction) {
      const c = r.compaction;
      ui.notice = `Before turn ${c.atTurn}, turns ${c.turns[0]}–${c.turns[1]} were replaced by a summary to fit the budget (${c.before} → ${c.after} tokens). The chat window still shows them.`;
      say('Older messages were summarised to fit the context budget.');
    }
    box.value = '';
    render();
  }

  function act(a, d) {
    switch (a) {
      case 'focusItem': {
        render();
        const el = document.getElementById('item-' + d.id);
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
        S._log('focusItem', { id: d.id }); return;
      }
      case 'useScript': $('input').value = SCRIPT[ui.scriptIdx] || ''; $('input').focus(); return;
      case 'toggleOrig': toggle('o:' + d.id); return;
      case 'toggleText': toggle('t:' + d.id); return;
      case 'pin': if (S.pinSentence(d.src, +d.idx)) say('Pinned. Context changed; re-answer is available.'); break;
      case 'restore': if (S.restoreSummary(d.id)) say('Original messages restored. Re-answer is available.'); break;
      case 'edit': ui.editing = d.id; break;
      case 'cancelEdit': ui.editing = null; break;
      case 'saveEdit': S.editItem(d.id, $('editBox').value); ui.editing = null; say('Edit saved.'); break;
      case 'resetEdit': S.resetItem(d.id); break;
      case 'toggleInclude': S.toggleInclude(d.id); break;
      case 'undo': if (S.undo()) say('Undone.'); break;
      case 'startAdd': ui.adding = true; break;
      case 'cancelAdd': ui.adding = false; break;
      case 'saveAdd': if (S.addInstruction($('addBox').value)) { ui.adding = false; say('Instruction added.'); } break;
      case 'reanswer': S.reanswer(); ui.notice = null; say('Re-answered with the updated context.'); break;
      case 'ver': { const m = S.chat.find((x) => x.id === d.id); m.active = +d.k; break; }
    }
    render();
    if (a === 'startAdd' && $('addBox')) $('addBox').focus();
  }
  function toggle(k) { ui.expanded.has(k) ? ui.expanded.delete(k) : ui.expanded.add(k); render(); }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    act(b.dataset.act, b.dataset);
  });
  $('form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('toggleInspector').addEventListener('change', (e) => { ui.inspector = e.target.checked; S._log('condition', { inspector: ui.inspector }); render(); });
  $('btnGuide').addEventListener('click', () => { const g = $('guide'); g.open = !g.open; });
  $('btnReset').addEventListener('click', () => { S = new Session(); Object.assign(ui, { expanded: new Set(), editing: null, adding: false, scriptIdx: 0, notice: null }); $('input').value = ''; render(); say('Session reset.'); });
  $('btnLog').addEventListener('click', () => {
    const data = { exportedAt: new Date().toISOString(), inspectorOn: ui.inspector, budget: S.budget, contextNow: S.items, log: S.log };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'context-inspector-session.json'; a.click(); URL.revokeObjectURL(a.href);
  });

  render();
})();
