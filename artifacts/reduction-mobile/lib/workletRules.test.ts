/**
 * lib/workletRules.test.ts — rules a worklet must keep that NOTHING else in
 * this container can see break (Oct 1).
 *
 * A function marked 'worklet' runs on the phone's UI thread, where only what
 * the worklets plugin copies into `this.__closure` exists. The plugin
 * unpacks that closure as the first line of the BODY — and JavaScript
 * evaluates default parameters before the body runs. So a default that names
 * anything from outside the function (`speed = TICKER.speed`) throws
 * "Property 'TICKER' doesn't exist" on the UI thread, which in a release
 * build closes the app. Chromium runs worklets as ordinary functions, where
 * the module scope is right there, so every browser check passes. That is
 * exactly how the reel's ticker shipped (Oct 1, the Find tab closing the
 * app): `tickerStep(offset, dt, period, speed = TICKER.speed)`, called with
 * three arguments.
 *
 * The rule: a worklet takes NO default parameter values. Pass the value in.
 * (Libraries do it with literals, `s = 1.70158`, which is safe; the rule is
 * stricter than that on purpose, because a literal today is a constant
 * tomorrow.) This parses every source file under the app's own code and
 * names each offender.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['app', 'components', 'lib', 'hooks', 'constants'];

function sources(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const isWorklet = (body: ts.Node | undefined): boolean => {
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'worklet';
};

/** Every worklet in the app's code, as `file:line name`, with its defaulted parameters. */
export function workletDefaults(): { worklets: number; offenders: string[] } {
  let worklets = 0;
  const offenders: string[] = [];
  for (const dir of DIRS) {
    for (const file of sources(path.join(root, dir))) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('worklet')) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isFunctionLike(node) && 'body' in node && isWorklet((node as ts.FunctionLikeDeclaration).body)) {
          worklets++;
          const fn = node as ts.FunctionLikeDeclaration;
          for (const p of fn.parameters) {
            if (p.initializer) {
              const line = sf.getLineAndCharacterOfPosition(p.getStart()).line + 1;
              const name = fn.name && ts.isIdentifier(fn.name) ? fn.name.text : '(anonymous)';
              offenders.push(`${path.relative(root, file)}:${line} ${name}(… ${p.getText()} …)`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return { worklets, offenders };
}

test('no worklet in the app takes a default parameter value (it is evaluated before the closure exists, on the UI thread)', () => {
  const { worklets, offenders } = workletDefaults();
  assert.ok(worklets >= 10, `the scan must actually find the app's worklets (found ${worklets})`);
  assert.deepEqual(offenders, []);
});
