/**
 * lib/configPlugins.test.ts — every local config plugin loads under plain
 * Node `require` (Oct 3).
 *
 * EAS Build reads app.json with its OWN copy of @expo/config-plugins, then
 * requires each local plugin file with plain Node resolution. Under pnpm the
 * phone app has no `@expo/config-plugins` of its own (it is a dependency of
 * `expo`, not of this package), so a plugin that requires it fails there —
 * build 8's first attempt died in "Read app config" on exactly that. Locally
 * `expo prebuild` and `expo config` both passed, because Expo's CLI resolves
 * the name for the plugins it loads. `expo/config-plugins` is the re-export
 * that resolves from here, so that is the only name a plugin may use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(root, 'plugins');

test('every local config plugin loads with plain require and exports a function', () => {
  const files = fs.readdirSync(pluginDir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const require = createRequire(path.join(pluginDir, f));
    const mod = require(path.join(pluginDir, f));
    assert.equal(typeof (mod.default ?? mod), 'function', f);
  }
});
