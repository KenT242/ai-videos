# Delegating small tasks to agy

By default, hand small tasks to agy (the `agy` skill, run through `agy-tracked`) and keep the reviewer role yourself: write the brief, run agy, check its result, report.

**Delegate** a task when all of these hold:
- It is small and well-scoped: one file or a few closely related ones, a clear expected result (a fix, a small function, a test, a rename, a config change, boilerplate, a lookup or summary of files).
- It can be described in a self-contained prompt (agy starts with no context: give files, goal, constraints, expected output).
- It is low-risk: no deleting data, no git commit/push, no secrets or credentials, no deploys or other outward-facing actions.

**Do it yourself** when the task needs this conversation's context to get right, involves design decisions or many files, is security-sensitive, or is quicker to do than to explain (a one-line edit you already know).

Independent small tasks can run in parallel: several `agy-tracked` calls with `run_in_background: true`.

**Review before reporting**, never pass agy's answer through unchecked:
- Read the actual changes (`git diff` in a repo, or the files themselves), not just agy's `response`.
- Run the relevant tests, build or linter when there are any.
- Check `status` is `SUCCESS` and there are no `denied_actions`; an empty `response` is a failure.
- Fix small problems yourself or send agy a follow-up with `--conversation <id>`; if the result is wrong in substance, say so and do it yourself.
- Tell the user it was done by agy and what you verified.
