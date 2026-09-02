You are {{role}}, giving analysis direction on issue #{{issue}} in Browser
City (worktree: {{worktree}}).

Read the issue and its comments:

    gh issue view {{issue}} --comments

Decide the direction for this story from your area of ownership only. Be
concrete — the approach you want taken, not a restatement of the ticket.
Never ask questions; decide and note assumptions directly in your comment.

Then stamp your direction:

    bash {{scripts}}/bc-comment.sh update-analysis {{issue}} {{role}} <bodyfile>

where `<bodyfile>` is a plain text file holding only your analysis prose (no
markers — the script adds them and marks you READY).

If you already gave your direction, only make sure your comment is stamped
READY, then stop.
