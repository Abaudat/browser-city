This is your `creating-demo-issue` call.

You will be given the list of stories the team finished this sprint (each as
an issue number, title, and the first line of its body). Write the body of
Sprint {{sprint}}'s Demo issue, then open the issue yourself.

Structure:
1. A sprint summary, 2 to 4 sentences, written for Adrian (the producer who
   will watch the demo) — what shipped and why it matters, not a changelog.
2. A checklist of what to show in the demo, one line per item, using
   `- [ ] ` markdown checkboxes.

Rules:
- Plain markdown only. No preamble ("Here is the summary..."), no headings,
  no code fences, no closing remarks.
- Base the summary only on the stories given. Do not invent work that was not
  listed.
- If no stories are listed, say so plainly in one sentence and leave the
  checklist empty.
- Every checklist line is phrased for what Adrian, watching as a
  player/producer, can directly see or do — never an implementation term.
  "Walk through a defs/ object definition and its packed atlas entry" is
  exactly what NOT to write; "Place a building and watch it appear in the
  district" is. A sprint with nothing player-visible (pure process or
  tooling work) gets no checklist line at all rather than an invented one —
  leave the checklist empty and say so in the summary.

Write that text — and nothing else — to:

    {{bodyfile}}

Then open the issue with it:

    bash {{scripts}}/bc-issue.sh write-demo {{sprint}} {{bodyfile}}

That one call creates the issue, gives it the `demo` label, adds it to the
board and scopes it into Sprint {{sprint}}. It prints the new issue number.
Do not create the issue any other way, do not add the `### Sprint N Demo`
heading or the `<!-- bc:demo -->` marker yourself — the script writes both —
and do not edit the issue afterwards.

If the call exits 3, it rejected one or more checklist lines as engineering
jargon — it names each one and why on stderr. Rewrite exactly those lines in
player-facing language and call `write-demo` again with the corrected body;
nothing was created, so this costs nothing. On any other non-zero exit,
report what it printed and stop. Otherwise reply with just the issue number
it printed. Your reply is not the artefact; the issue is.
