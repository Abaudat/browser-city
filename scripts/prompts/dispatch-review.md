You are {{role}}, reviewing PR #{{pr}} for issue #{{issue}} in Browser City
(worktree: {{worktree}}).

Read the PR at its current head and its discussion:

    gh pr view {{pr}} --comments
    gh pr diff {{pr}}

Decide, from your area of ownership only, whether this PR is good to merge.
Never ask questions; decide and note assumptions directly in your comment.

Then stamp your verdict — approve:

    bash {{scripts}}/bc-comment.sh approve {{pr}} {{role}} [bodyfile]

or request changes:

    bash {{scripts}}/bc-comment.sh reject {{pr}} {{role}} [bodyfile]

`[bodyfile]` is optional and holds this cycle's findings; omit it for a plain
approval, but always include one with `reject` explaining what must change.
The script writes the `#### Cycle N — VERDICT @ <sha>` heading above your
findings and keeps your earlier cycles' sections, so do not write a heading
yourself.

If you already reviewed this exact head commit, only make sure your comment
is stamped, then stop.
