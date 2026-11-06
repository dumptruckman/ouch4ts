# Enable npm releases

Keep the repository variable `RELEASES_ENABLED` unset or `false` until you finish
this guide. See the [release process](releases.md) for workflow behavior and
authentication.

## Protect the release branches

1. Create the labels `release:major`, `release:minor`, `release:patch`, and `no release`.
2. In **Settings > Actions > General**, allow the actions used in `.github/workflows/`.
3. Enable **Allow GitHub Actions to create and approve pull requests**.
4. Protect `main` and `maintenance/*` with these rules:

   - Require pull requests and an approving review.
   - Require the **Build and test** and **Release labels** checks.
   - Require branches to be up to date before merging.
   - Dismiss stale approvals when commits change.
   - Disable force pushes and deletions.
   - Apply the protections to the release bot without a bypass.

5. Create the `npm-release` environment.
6. Restrict deployments to `main`, `maintenance/*`, and source tags explicitly
   approved for recovery. Exclude arbitrary feature branches.

An environment reviewer is optional. Merging a current release PR approves its
stable publication.

If GitHub requires CI approval for a bot-created release PR, approve the current
PR run. Wait for the required checks before reviewing and merging the PR. A
manually dispatched CI run does not replace required PR checks.

## Establish the first stable baseline

Before selecting the source commit, pause merges until the recorder is enabled.
This prevents post-baseline merges from going unrecorded.

1. Complete [Verify the npm artifact and release path](https://github.com/dumptruckman/ouch4ts/issues/10).
2. Select the reviewed source commit for the real `ouch4ts@0.1.0`.
3. In a clean checkout, [build and test the package](development.md#check-a-change).
4. [Pack the package](development.md#inspect-the-npm-package) and inspect the tarball.
5. Publish that artifact interactively with your npm account and two-factor
   authentication. Use public access. Do not publish a placeholder package.
6. Verify the registry artifact against the reviewed tarball.
7. Create `v0.1.0` at the reviewed source commit.
8. Complete its GitHub release.
9. Set the repository variable `RELEASE_BASELINE_TAG` to `v0.1.0`.

The tag excludes all earlier history from pending release changes. Preserve it.
The first publication requires an npm account with permission to create
`ouch4ts`. Automated publication cannot establish trust for an unpublished package.

## Connect the trusted publisher

In the npm package's **Settings > Trusted publishing**, add a GitHub Actions publisher with these values:

| Field | Value |
| --- | --- |
| Organization or user | `dumptruckman` |
| Repository | `ouch4ts` |
| Workflow filename | `release.yml` |
| Environment name | `npm-release` |
| Allowed actions | Direct `npm publish` and `npm dist-tag` |

Complete the first automated publication within two days after creating the
connection. If the connection expires unused, delete it and create a new one.
npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
describes these settings and the first-use limit.

## Enable publication

1. Verify account access, branch protections, environment restrictions, baseline
   identity, and the trusted publisher.
2. Set the repository variable `RELEASES_ENABLED` to `true`.
3. Resume merges with a reviewed PR that has a release label.
4. Verify its automated preview publication.
