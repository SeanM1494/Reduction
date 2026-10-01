/**
 * lib/publishGuards.test.ts — the refusals scripts/publish-update.mjs makes
 * before promoting a preview update to production (scripts/publishGuards.mjs),
 * with git replaced by a table of answers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — a plain .mjs module, no type declarations; the runner loads it.
import { classifyCommit, parseUpdateView, promoteProblems, promotedMessage } from '../scripts/publishGuards.mjs';

type Answer = { ok: boolean; out: string };
/** A fake git: `history` maps a commit to its parent and the files it changes. */
function fakeGit(opts: { known: string[]; onMain: string[]; history: Record<string, { parent: string; files: string[] }> }) {
  return (args: string[]): Answer => {
    const [cmd, ...rest] = args;
    if (cmd === 'cat-file') return { ok: opts.known.includes(rest[1].replace('^{commit}', '')), out: '' };
    if (cmd === 'merge-base' && rest[0] === '--is-ancestor') return { ok: opts.onMain.includes(rest[1]), out: '' };
    if (cmd === 'merge-base') {
      let c = rest[0];
      while (c && !opts.onMain.includes(c)) c = opts.history[c]?.parent;
      return { ok: !!c, out: c ? `${c}\n` : '' };
    }
    if (cmd === 'rev-list') {
      const [base, tip] = rest[0].split('..');
      const out: string[] = [];
      for (let c = tip; c && c !== base; c = opts.history[c]?.parent) out.push(c);
      return { ok: true, out: out.join('\n') };
    }
    if (cmd === 'diff-tree') return { ok: true, out: (opts.history[rest[rest.length - 1]]?.files ?? []).join('\n') };
    return { ok: false, out: '' };
  };
}

const repo = fakeGit({
  known: ['m1', 'm2', 'r1', 'r2', 'x1'],
  onMain: ['m1', 'm2'],
  history: {
    m2: { parent: 'm1', files: ['a.ts'] },
    r1: { parent: 'm2', files: [] }, // Replit's "Published your App"
    r2: { parent: 'r1', files: [] },
    x1: { parent: 'm2', files: ['artifacts/reduction-mobile/app.json'] }, // a local edit
  },
});

test('a commit on main, Replit\'s empty commits on top of main, a local change, and a commit this checkout lacks', () => {
  assert.deepEqual(classifyCommit('m2', repo), { status: 'on-main' });
  assert.deepEqual(classifyCommit('r2', repo), { status: 'empty-on-main', base: 'm2', empty: ['r2', 'r1'] });
  assert.deepEqual(classifyCommit('x1', repo), { status: 'not-on-main', changing: ['x1'] });
  assert.deepEqual(classifyCommit('zz', repo), { status: 'unknown' });
  assert.deepEqual(classifyCommit('', repo), { status: 'unknown' });
});

const ok = [{ id: 'u1', group: 'g1', branch: 'preview', message: 'Fix Find (abc1234)', runtimeVersion: '1.1.0', platform: 'ios', gitCommitHash: 'm2', isRollBackToEmbedded: false }];

test('a preview group from main is promotable; Replit\'s empty commits are too', () => {
  assert.deepEqual(promoteProblems(ok, { status: 'on-main' }), []);
  assert.deepEqual(promoteProblems(ok, { status: 'empty-on-main' }), []);
});

test('refused: not on preview, not on main, unknown commit, no commit, two commits, a roll-back, no group', () => {
  assert.match(promoteProblems([{ ...ok[0], branch: 'production' }], { status: 'on-main' })[0], /branch production, not preview/);
  assert.match(promoteProblems(ok, { status: 'not-on-main', changing: ['x1'] })[0], /not on main \(changes in x1\)/);
  assert.match(promoteProblems(ok, { status: 'unknown' })[0], /does not have that commit/);
  assert.match(promoteProblems([{ ...ok[0], gitCommitHash: null }], null)[0], /records no git commit/);
  assert.match(promoteProblems([ok[0], { ...ok[0], gitCommitHash: 'm1' }], { status: 'on-main' })[0], /more than one commit/);
  assert.match(promoteProblems([{ ...ok[0], isRollBackToEmbedded: true }], { status: 'on-main' })[0], /roll-back/);
  assert.match(promoteProblems([], null)[0], /no update group/);
  assert.match(promoteProblems(null, null)[0], /no update group/);
});

test('update:view output is read through the log lines eas prints around it', () => {
  const text = '🔍 [expo-iap] Config values: x\n📦 [expo-iap] Using OpenIAP\n' + JSON.stringify(ok, null, 2) + '\n';
  assert.deepEqual(parseUpdateView(text), ok);
  assert.equal(parseUpdateView('Error: not found'), null);
  assert.equal(parseUpdateView('[ not json'), null);
});

test('the production copy carries the preview message, marked once', () => {
  assert.equal(promotedMessage('Fix Find (abc1234)'), 'Fix Find (abc1234) (promoted from preview)');
  assert.equal(promotedMessage('Fix Find (abc1234) (promoted from preview)'), 'Fix Find (abc1234) (promoted from preview)');
});
