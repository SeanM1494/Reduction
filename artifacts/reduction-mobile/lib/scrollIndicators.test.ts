/**
 * No scroll indicators, anywhere in the app (Sep 25, from a real phone:
 * bars showing on pages that should not have them). React Native has no
 * app-wide default for these props, so every scroll container sets both
 * itself — and this reads the source to make sure a new one does too.
 *
 * Pure: reads files, imports nothing from react-native, so the node runner
 * can load it (see scripts/run-tests.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const DIRS = ["app", "components"];
const OPENERS = /<(ScrollView|FlatList|SectionList|Animated\.ScrollView|Animated\.FlatList|KeyboardAwareScrollView)\b/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

/** The props of the JSX element starting at `from`: up to its first `>`
 *  that is not inside braces. */
function openingTag(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[i - 1] !== "=") return src.slice(from, i + 1);
  }
  return src.slice(from);
}

test("every scroll container hides both scroll indicators", () => {
  const missing: string[] = [];
  for (const file of DIRS.flatMap((d) => files(join(ROOT, d)))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(OPENERS)) {
      // `useRef<ScrollView>` is a type argument, not an element.
      if (/[\w.]/.test(src[m.index! - 1] ?? "")) continue;
      // EditSheet has a component of its own called SectionList.
      if (m[1] === "SectionList" && /function SectionList\b/.test(src)) continue;
      const tag = openingTag(src, m.index!);
      for (const prop of ["showsVerticalScrollIndicator={false}", "showsHorizontalScrollIndicator={false}"]) {
        if (!tag.includes(prop)) {
          const line = src.slice(0, m.index).split("\n").length;
          missing.push(`${file.slice(ROOT.length + 1)}:${line} <${m[1]}> lacks ${prop}`);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});
