const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

/**
 * pnpm workspace wiring, made EXPLICIT rather than left to detection.
 *
 * Expo's config already sniffs out the monorepo root, but the app also
 * depended on a per-package symlink (node_modules/@workspace/recipe-model)
 * that only exists after `pnpm install` has completed — and on Replit the
 * post-merge hook's install was timing out, leaving the app to crash on load
 * with "Unable to resolve module @workspace/recipe-model/amounts". The alias
 * below resolves the model package straight to its directory, so the app
 * boots whether or not that link was ever created. The package's own
 * `exports` map still routes subpaths (/amounts, /layout, ...) to src/.
 */
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@workspace/recipe-model': path.resolve(workspaceRoot, 'lib', 'recipe-model'),
};

module.exports = config;
