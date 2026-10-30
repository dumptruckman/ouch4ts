# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `dumptruckman/ouch4ts`.
Use the `gh` CLI from this clone.

## Conventions

Before the first issue creation in a session, verify the target with
`gh repo view --json nameWithOwner`. It must be `dumptruckman/ouch4ts`.

- Create: `gh issue create --title "..." --body-file <file>`.
  Write multiline bodies to a temporary file.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
  Add label and state filters as needed.
- Comment: `gh issue comment <number> --body-file <file>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."`
  or `--remove-label "..."`.
- Close: post the explanation with `gh issue comment`, then run
  `gh issue close <number>`. Post comments separately so they are
  retained when an issue is already closed.

Publishing to the issue tracker means creating a GitHub issue.
Fetching a ticket means reading its GitHub issue.

## Parent issues and blockers

Use native GitHub sub-issues and issue dependencies.

Get an issue's numeric database ID with:
`gh api repos/dumptruckman/ouch4ts/issues/<number> --jq .id`.

- Add a child:
  `gh api --method POST repos/dumptruckman/ouch4ts/issues/<parent>/sub_issues -F sub_issue_id=<child-database-id>`.
- Add a blocker:
  `gh api --method POST repos/dumptruckman/ouch4ts/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-database-id>`.
- Count open blockers:
  `gh api repos/dumptruckman/ouch4ts/issues/<number> --jq .issue_dependencies_summary.blocked_by`.

If sub-issues are unavailable, add the child to a task list in the
parent and put `Part of #<parent>` at the top of the child body.
If dependencies are unavailable, put `Blocked by: #<number>` at the
top of the child body. Work can start when every blocker is closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child: link it to the map and label it `wayfinder:<type>`,
  using research, prototype, grilling, or task.
- Frontier: choose the first open child in map order with no
  assignee and no open blockers.
- Claim: `gh issue edit <number> --add-assignee @me`.
- Resolve: comment with the answer, close the child, then append
  a brief finding and link to the map's Decisions-so-far.
