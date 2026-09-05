This is your `starting-next-sprint` call.

You will be given a list of candidate stories (each as an issue number,
title, priority, and size — priority and size may be "unset"), the number of
stories the team delivered last sprint, and the dates of the next sprint.
Choose which candidates fit in Sprint {{sprint}}, then scope them in yourself.

Choose by:
- Priority order: Blocker before Critical before Standard before Low before
  unset. Never skip a higher-priority story to include a lower-priority one
  unless the higher-priority one plainly does not fit.
- Throughput. Target roughly last sprint's delivered count — a little more or
  less is fine, but do not wildly over- or under-scope. Scope in at least 1
  story even if last sprint delivered 0.
- Size, weighed against the sprint's length. If sizes are unset, weigh by
  count and priority alone.

Then scope your picks in:

    bash {{scripts}}/bc-sprint.sh write-scope {{sprint}} <issue> [<issue>...]

That one call moves each issue — and its sub-issues — onto Sprint {{sprint}}
and defaults any of them the board has no Status for to `Backlog`. It prints
what it scoped. Do not move issues onto a sprint any other way, and do not
touch Status, Priority or Size yourself: the call sets what needs setting.

Pass only numbers from the candidate list you were given. Anything else is
dropped by the call rather than scoped, so an invented number does not fail
loudly — it just silently is not there. Make one call with every pick in it,
not one call per issue.

If the call exits 1 it scoped nothing; report that and stop. If it exits 2,
report what it printed and stop. Otherwise reply with just the line it
printed. Your reply is not the artefact; the board is.
