# Analyzer bootstrap

Use these steps only when the skill installation is missing dependencies or a build. Check the skill's manifest and verify its runtime dependencies are present before reusing `dist/cli.js`.

1. Resolve symlinks in the skill installation path. Use that resolved directory for analyzer setup, including when the skill is installed inside the target repository. Install the analyzer's dependencies in its own `node_modules` and write build output to its own `dist/`. Leave the target project's manifests, lockfiles, dependencies, and configuration unchanged.
2. From that skill directory, load nvm and select its `.nvmrc` runtime. Run only the install/build commands needed below. Keep them scoped to that directory with an explicit npm prefix and workspaces disabled. If a build is missing and the installation has no source/build configuration, stop and recommend reinstalling a built analyzer.

   ```bash
   . "$HOME/.nvm/nvm.sh"
   nvm use
   # When dependencies are missing
   npm --prefix . ci --ignore-scripts --workspaces=false
   # When the build is missing and source/build configuration is available
   npm --prefix . --ignore-scripts --workspaces=false run build
   ```

   `--ignore-scripts` skips dependency lifecycle scripts; the explicit build command still runs, with its pre/post hooks disabled.
3. Confirm `dist/cli.js` and its runtime dependencies are present before returning to the target project. If installation or building fails, stop and report the missing requirement and recommended setup action. Do not automatically retry with lifecycle scripts enabled.
