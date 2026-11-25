// Run: node test/core.test.js   (no dependencies)
const assert = require('node:assert/strict');
const { Session, SCRIPT } = require('../core.js');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok  -', name); }
const play = (s, n) => { for (let k = 0; k < n; k++) s.send(SCRIPT[k]); };

t('turns 1-4 keep every message original (no compaction yet)', () => {
  const s = new Session(); play(s, 4);
  assert.equal(s.events.length, 0);
  assert.ok(s.items.every((i) => i.kind !== 'summary'));
});

t('turn 5 triggers compaction of turns 1-3 into one summary, and the constraint is lost', () => {
  const s = new Session(); play(s, 4);
  const r = s.send(SCRIPT[4]);
  assert.deepEqual(r.compaction.turns, [1, 3]);
  const sum = s.items.find((i) => i.kind === 'summary');
  assert.equal(sum.sources.length, 6);
  assert.ok(!/architecture/i.test(sum.text));
  assert.equal(r.reply.mode, 'refactor-suggested');
  assert.ok(r.compaction.after < r.compaction.before && r.compaction.after <= s.budget, 'compaction brings the prompt back under budget');
});

t('before compaction the same question gets a fix-only answer', () => {
  const s = new Session(); play(s, 1);
  const r = s.send(SCRIPT[4]);
  assert.equal(r.reply.mode, 'fix-only');
});

t('droppedSentences flags the constraint sentence but not the app description', () => {
  const s = new Session(); play(s, 5);
  const d = s.droppedSentences(s.items.find((i) => i.kind === 'summary')).filter((x) => x.dropped);
  assert.equal(d.length, 1);
  assert.match(d[0].sentence, /Never modify/);
});

t('pin sentence -> context changed -> re-answer becomes fix-only (v2) and change flag clears', () => {
  const s = new Session(); play(s, 5);
  assert.equal(s.changedSinceReply(), false);
  assert.ok(s.pinSentence('u1', 1));
  assert.equal(s.changedSinceReply(), true);
  const r = s.reanswer();
  assert.equal(r.mode, 'fix-only');
  assert.equal(s.lastAssistant().versions.length, 2);
  assert.equal(s.changedSinceReply(), false);
  assert.equal(s.items[0].kind, 'pinned');
});

t('pinning the same sentence twice is ignored', () => {
  const s = new Session(); play(s, 5);
  assert.ok(s.pinSentence('u1', 1));
  assert.equal(s.pinSentence('u1', 1), false);
});

t('restore originals puts messages back and protects them from re-summarising', () => {
  const s = new Session(); play(s, 5);
  s.restoreSummary(s.items.find((i) => i.kind === 'summary').id);
  assert.ok(s.items.filter((i) => i.state === 'restored').length === 6);
  s.send('Another message that is long enough to push the context over the budget again please.');
  assert.ok(s.items.filter((i) => i.state === 'restored').length === 6, 'restored items survive next compaction');
});

t('edit makes item protected and changes what the assistant receives', () => {
  const s = new Session(); play(s, 5);
  const sum = s.items.find((i) => i.kind === 'summary');
  s.editItem(sum.id, sum.text + ' Constraint: never modify my current code architecture.');
  assert.equal(s.reanswer().mode, 'fix-only');
  assert.equal(s.stateOf(s.items.find((i) => i.id === sum.id)), 'edited');
  s.resetItem(sum.id);
  assert.equal(s.items.find((i) => i.id === sum.id).state, 'summarized');
});

t('excluding the item that holds the constraint removes it from context', () => {
  const s = new Session(); play(s, 1);
  s.toggleInclude('u1');
  assert.equal(s.send(SCRIPT[4]).reply.mode, 'refactor-suggested');
});

t('undo reverts the last inspector action', () => {
  const s = new Session(); play(s, 5);
  const before = JSON.stringify(s.items);
  s.pinSentence('u1', 1);
  assert.ok(s.undo());
  assert.equal(JSON.stringify(s.items), before);
  assert.equal(s.undo(), false);
});

t('typed standing instruction works, and retyping the constraint in chat also works', () => {
  const s = new Session(); play(s, 5);
  s.addInstruction('Never modify my current code architecture; fix bugs only.');
  assert.equal(s.reanswer().mode, 'fix-only');
  const s2 = new Session(); play(s2, 5);
  assert.equal(s2.send('Reminder: never change my architecture. Checkout is still slow.').reply.mode, 'fix-only');
});

t('session log records actions in order', () => {
  const s = new Session(); play(s, 5); s.pinSentence('u1', 1); s.reanswer();
  const types = s.log.map((e) => e.type);
  assert.deepEqual(types.slice(-4), ['compaction', 'send', 'pin', 'reanswer']);
});

t('re-answer records what changed in the context (added/removed)', () => {
  const s = new Session(); play(s, 5);
  s.pinSentence('u1', 1);
  const r = s.reanswer();
  assert.deepEqual(r.delta.added, ['Pinned instruction']);
  assert.deepEqual(r.delta.removed, []);
  s.restoreSummary(s.items.find((i) => i.kind === 'summary').id);
  assert.ok(s.reanswer().delta.removed.some((l) => /^Summary of turns/.test(l)));
});

t('statusOfMessage maps chat messages to their context state', () => {
  const s = new Session(); play(s, 5);
  assert.equal(s.statusOfMessage('u1').state, 'summarized');
  assert.equal(s.statusOfMessage('u1').itemId, 's1');
  assert.equal(s.statusOfMessage('u4').state, 'original');
  s.toggleInclude('u4');
  assert.equal(s.statusOfMessage('u4').state, 'excluded');
});

t('assistant is swappable: a stub adapter only needs to return { text }', () => {
  const seen = [];
  const s = new Session({ assistant: (ctx, u) => { seen.push(ctx.length); return { text: 'stub:' + u }; } });
  const r = s.send('hello');
  assert.equal(r.reply.text, 'stub:hello');
  assert.equal(r.reply.mode, 'unknown');
  assert.equal(r.reply.used.length, 1);
  assert.deepEqual(seen, [1]);
});

console.log(`\n${passed} tests passed`);
