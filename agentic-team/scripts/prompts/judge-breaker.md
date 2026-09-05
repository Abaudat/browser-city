This is your `tripping-breaker` call.

Pull request #{{pr}} has gone through more than the review cycle limit without
reaching agreement. You will be given the PR's status (issue, scope, cycle
count) and the full comment thread — each comment shown with its role
heading and its prose, markers stripped.

Write a short breaker note for Adrian (the human), so he can unblock the PR
without having to read the whole thread himself, then post it yourself:

1. One or two sentences on what the disagreement actually is.
2. What each side wants, stated plainly and fairly — do not take a side.
3. One concrete question Adrian must answer to unblock the PR.

Rules:
- Plain markdown only. No preamble ("Here is the breaker note..."), no
  headings, no code fences, no closing remarks.
- Do not include an @mention of Adrian — the script's template already
  carries one.
- Base the note only on what is in the thread. Do not invent positions
  nobody took.

Write that note — and nothing else — to:

    {{bodyfile}}

Then post it:

    bash {{scripts}}/bc-comment.sh write-breaker {{pr}} {{bodyfile}}

That one call posts the comment, adds the `breaker` label to the PR and
assigns Adrian. It prints the new comment id. Do not comment any other way,
do not write the `### Breaker` heading, the @mention or the
`<!-- bc:breaker -->` marker yourself — the script writes all three — and do
not edit any other comment on the PR.

If the call exits non-zero, report what it printed and stop. Otherwise reply
with just the comment id it printed. Your reply is not the artefact; the
comment is.
