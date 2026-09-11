This is your `starting-next-sprint` call.

You will be given every story that could go into Sprint {{sprint}}, grouped
under its epic with how far along that epic is (each story as an issue
number, title, priority and size — priority and size may be "unset"); the
work already on Sprint {{sprint}} because the team had started it; what the
team delivered last sprint, with sizes; and the dates of the next sprint.
Choose which candidates fit in Sprint {{sprint}}, then scope them in yourself.

Choose by:
- Epic order, first. The epics are listed in the order they must be
  finished. Every remaining story of the first epic goes in before any story
  of the one after it — a sprint may take part of an epic, but never skip
  past one. Only once all of an epic's candidates are picked may what is left
  of the sprint go to the next epic. Stories in no epic sit outside that
  order.
- Throughput, weighed by size. Target roughly what last sprint delivered,
  counting the work already on Sprint {{sprint}} against it — a little more or
  less is fine, but do not wildly over- or under-scope. Scope in at least 1
  story even if last sprint delivered nothing. If sizes are unset, weigh by
  count alone.
- Within an epic, priority: Blocker before Critical before Standard before Low
  before unset. Never skip a higher-priority story to include a lower-priority
  one unless the higher-priority one plainly does not fit.

Then scope your picks in:

    bash {{scripts}}/bc-sprint.sh write-scope {{sprint}} <story> [<story>...]

That one call moves each story onto Sprint {{sprint}} and defaults any the
board has no Status for to `Backlog`. It prints what it scoped. Do not move
issues onto a sprint any other way, and do not touch Status, Priority or Size
yourself: the call sets what needs setting. Never pass an epic — epics are
never scoped, only their stories.

Pass only numbers from the candidate list you were given. The call drops
anything else, and it drops any story whose epic comes after an epic you left
stories out of; it names what it dropped and why on stderr. Make one call
with every pick in it, not one call per story. If it dropped something you
meant to scope, you broke the epic order: do not call it again to force the
story in — report it.

If the call exits 1 it scoped nothing; report that and stop. If it exits 2,
report what it printed and stop. Otherwise reply with just the line it
printed. Your reply is not the artefact; the board is.
