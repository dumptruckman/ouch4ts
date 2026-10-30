# Analyzer bootstrap

Until npm publication, the skill requires a full `ouch4ts` repository checkout. Use these steps when the root analyzer is missing dependencies or a build.

1. Resolve symlinks in the skill installation path. The analyzer checkout root is two directories above `skills/ouch4ts`. Verify its `package.json` names `ouch4ts` and that `package-lock.json`, `src/`, `tsconfig.build.json`, and `.nvmrc` are present. If the checkout is missing, stop and recommend cloning `dumptruckman/ouch4ts`, building at its root, and linking its `skills/ouch4ts` directory into the agent's skill location. A separately copied skill has no analyzer source or build configuration.
2. Use the checkout's manifest to check runtime dependencies before reusing its `dist/cli.js`. For setup, select the Node version in the root `.nvmrc` using the user's runtime setup instructions. Run only the commands needed below, replacing `/absolute/path/to/ouch4ts` with the resolved checkout root. Dependencies go into the root `node_modules` and build output into the root `dist/`. Leave the target project's manifests, lockfiles, dependencies, and configuration unchanged.

   ```bash
   # When dependencies are missing
   npm --prefix /absolute/path/to/ouch4ts ci --ignore-scripts
   # When the build is missing and source/build configuration is available
   npm --prefix /absolute/path/to/ouch4ts --ignore-scripts run build
   ```

   `--ignore-scripts` skips dependency lifecycle scripts; the explicit build command still runs, with its pre/post hooks disabled.
3. Confirm the checkout's `dist/cli.js` and its runtime dependencies are present before returning to the target project. If installation or building fails, stop and report the missing requirement and recommended setup action. Do not automatically retry with lifecycle scripts enabled.
