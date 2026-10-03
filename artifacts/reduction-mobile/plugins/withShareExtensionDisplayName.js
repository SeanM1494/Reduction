/**
 * plugins/withShareExtensionDisplayName.js — the share extension's name in
 * the Share sheet is "Reduction", the app's own.
 *
 * expo-share-intent uses ONE option for both the extension's display name
 * and its Xcode target name, and a target called "Reduction" would collide
 * with the app's own target. So app.json names the extension "Reduction
 * Share" (target ReductionShare) and this rewrites the display name in the
 * Info.plist the package has just written.
 *
 * ORDER MATTERS: an Xcode-project mod registered EARLIER in app.json's
 * plugins runs LATER, so this sits before "expo-share-intent" there.
 * `npx expo prebuild --platform ios --no-install` and reading
 * ios/ReductionShare/ShareExtension-Info.plist is the check (then delete
 * ios/, which is never committed).
 */
const fs = require('node:fs');
const path = require('node:path');
const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withShareExtensionDisplayName(config, { target = 'ReductionShare', displayName = 'Reduction' } = {}) {
  return withXcodeProject(config, (cfg) => {
    const file = path.join(cfg.modRequest.platformProjectRoot, target, 'ShareExtension-Info.plist');
    if (!fs.existsSync(file)) {
      throw new Error(`withShareExtensionDisplayName: ${file} was not written; is this plugin listed before expo-share-intent in app.json?`);
    }
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${displayName}$2`,
    );
    if (after === before && !before.includes(`<string>${displayName}</string>`)) {
      throw new Error(`withShareExtensionDisplayName: no CFBundleDisplayName in ${file}`);
    }
    fs.writeFileSync(file, after);
    return cfg;
  });
};
