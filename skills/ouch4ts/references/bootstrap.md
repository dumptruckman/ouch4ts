# Analyzer bootstrap

Use these steps only when the skill installation is missing dependencies or a build. Check the skill's manifest and verify its runtime dependencies are present before reusing `dist/cli.js`.

1. Resolve symlinks in the skill installation and target project paths. Confirm the skill installation is outside the target project's Git root, or outside the project directory when it has no Git repository. If it is inside, stop and recommend installing the skill outside the target repository or having the user build it as a separate setup action.
2. From that external skill directory, load nvm and select its `.nvmrc` runtime. Run only the install/build commands needed below. Keep them scoped to that directory with an explicit npm prefix and workspaces disabled. If a build is missing and the installation has no source/build configuration, stop and recommend reinstalling a built analyzer.

   ```bash
   . "$HOME/.nvm/nvm.sh"
   nvm use
   # When dependencies are missing
   npm --prefix . ci --ignore-scripts --workspaces=false
   # When the build is missing and source/build configuration is available
   npm --prefix . --ignore-scripts --workspaces=false run build
   ```

   `--ignore-scripts` skips dependency lifecycle scripts; the explicit build command still runs, with its pre/post hooks disabled.
3. Confirm `dist/cli.js` and its runtime dependencies are present before returning to the target project. If installation or building fails, stop and report the missing requirement and recommended setup action. Do not automatically retry with lifecycle scripts enabled or install into the target project.
