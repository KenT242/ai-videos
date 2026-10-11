# Research brief: {{TOPIC}}

You are fact-checking the on-screen text of a {{LENGTH}} animated video about **{{TOPIC}}** (captions in {{LANGUAGE}}). You have about {{MINUTES}} minutes. Use web search. Do not edit any files and do not run builds. Return only the JSON report.

## Claims to check

Each claim is one short line that will appear on screen or drive a scene. For each one:
- Find **2 independent sources**, preferably primary (the paper, the official announcement, the person's own post) or reputable (an encyclopedia, a major newspaper, a university page). Blogs and SEO "statistics" pages don't count on their own.
- Give the exact date and number the sources support, and quote the short passage that supports it.
- Rate the support:
  - `strong`: 2+ good sources agree;
  - `weak`: a single source, or only secondary sources;
  - `conflicting`: the sources disagree, so say how;
  - `false`: the claim is wrong, so give the correct version.
- Propose `onScreen` wording that the sources support exactly, in {{LANGUAGE}}, at most ~6 words. Example: "1 million sign-ups", not "1 million users".

{{CLAIMS}}

## Open questions

Answer each one with a short, true fact that is suitable for the screen, and give its sources:

{{QUESTIONS}}

## Rules

- Never claim "first", "only" or "biggest" unless a source says so explicitly.
- Prefer exact dates (YYYY-MM-DD) where they exist.
- Don't pad the report. If you can't find support for a claim, say so and rate it `weak`.
- Budget: about {{CALLS}} tool calls in total. Stop searching a claim once it has two good sources.
