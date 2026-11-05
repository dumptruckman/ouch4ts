# Enable npm releases

Keep the repository variable `RELEASES_ENABLED` unset or `false` until you finish these steps. The workflows use the built-in `GITHUB_TOKEN` and npm trusted publishing. They require no repository secret, PAT, GitHub App, private key, or `NODE_AUTH_TOKEN`.

## Protect the release branches

1. Create the labels `release:major`, `release:minor`, `release:patch`, and `no release`.
2. In **Settings > Actions > General**, allow the actions used in `.github/workflows/` and enable **Allow GitHub Actions to create and approve pull requests**. The workflows request their own token permissions.
3. Protect `main` and `maintenance/*`. Require pull requests, an approving review, the `Build and test` check, and the `Release labels` check. Require branches to be up to date before merging. Dismiss stale approvals when commits change. Disable force pushes and deletions. Do not grant the release bot a protection bypass.
4. Create the `npm-release` environment. Restrict deployments to `main`, `maintenance/*`, and the source tags you explicitly approve for recovery. Do not allow arbitrary feature branches. An environment reviewer is optional; merging a current release PR is the stable-release approval.

GitHub may require you to approve CI for a bot-created release PR. Approve the current PR run, wait for required checks, then review and merge it. A manually dispatched CI run does not replace required PR checks.

## Establish the first stable baseline

1. Complete [Verify the npm artifact and release path](https://github.com/dumptruckman/ouch4ts/issues/10) before publishing.
2. Select the reviewed source commit for the real `ouch4ts@0.1.0`. Build, test, and inspect its packed artifact in a clean checkout.
3. Publish that artifact interactively with your npm account and 2FA. Use public access. Do not publish a placeholder package.
4. Verify the registry artifact against the reviewed tarball. Create `v0.1.0` at that exact source commit and complete its GitHub release.
5. Set the repository variable `RELEASE_BASELINE_TAG` to `v0.1.0`. This tag excludes all earlier history from pending release changes. Preserve it.

The first publication requires an npm account with permission to create `ouch4ts`. Automated publication cannot establish trust for an unpublished package.

## Connect the trusted publisher

In the npm package's **Settings > Trusted publishing**, add a GitHub Actions publisher with these values:

| Field | Value |
| --- | --- |
| Organization or user | `dumptruckman` |
| Repository | `ouch4ts` |
| Workflow filename | `release.yml` |
| Environment name | `npm-release` |
| Allowed actions | Direct `npm publish` and `npm dist-tag` |

Create this connection within two days of its first automated publication. If it expires unused, delete it and create a new connection. npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) describes these settings and the first-use limit.

The publisher uses GitHub-hosted `ubuntu-24.04`, Node `24.22.1`, and npm `12.2.1`. Its job requests `contents: write`, `pull-requests: read`, and `id-token: write`. Proposal updates request `contents: write` and `pull-requests: write`. PR CI has read-only permissions and no publishing environment.

After verifying account access, branch protections, environment restrictions, baseline identity, and the trusted publisher, set `RELEASES_ENABLED` to `true`. Merge a reviewed, labelled PR to exercise the first automated preview. No setup command in this guide enables publication automatically.
