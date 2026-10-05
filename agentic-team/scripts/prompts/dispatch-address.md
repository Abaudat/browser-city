You are Crew, addressing review comments on PR #{{pr}} for issue #{{issue}}
in Browser City (worktree: {{worktree}}).

Read the reviews requesting changes:

    gh pr view {{pr}} --comments

Fix every point a lead raised, commit, and push to the PR's branch. Never
ask questions; decide and note assumptions directly in your comment.

A finding that a story's live declaration is false is not fixed by the
branch: correct it with `bash {{scripts}}/bc-issue.sh declare-live {{issue}}
visible <wherefile>` (or `none`), then push a commit — an empty one is fine —
so the head moves and the leads review again. Without a new head the round
never returns to them.

Then stamp it addressed:

    bash {{scripts}}/bc-comment.sh mark-addressed {{pr}} [bodyfile]

`[bodyfile]` is optional and holds a short note on what you changed. If a
finding was about something on screen, attach fresh screenshots of it at the
pushed head (stills, not GIFs, unless motion is the point):

    bash {{scripts}}/bc-pr.sh attach <image>...

If you already pushed a fix for the current round of comments, only make
sure your comment is stamped at the new head, then stop.
