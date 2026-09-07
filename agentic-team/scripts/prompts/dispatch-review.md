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

If, and only if, you found real work that this PR genuinely cannot carry —
not a finding Crew could address this cycle, which is a `reject`, and not a
preference — you may ask Scotty to create it:

    bash {{scripts}}/bc-comment.sh request-task {{pr}} {{role}} <bodyfile>

`<bodyfile>` says what the work is, why this PR cannot carry it, and which
requirement it serves. Use this sparingly: Scotty rules against the whole
epic and denies more often than not, an epic that grows a story per review
cycle never finishes, and a request is not a verdict — stamp yours either
way, in this same dispatch.

If you already reviewed this exact head commit, only make sure your comment
is stamped, then stop.
