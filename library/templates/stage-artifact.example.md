# ✅ <Stage title>: <one-line outcome>

A one- or two-sentence operator summary: what this stage did, the outcome, and
the single next action. Lead with the answer.

**Next action:** <what the operator or next stage should do>

## 🎯 Acceptance

How the work maps to the acceptance criteria. Use a short list, one line each.

- ✅ **AC-1** — <criterion> — <how it was satisfied, with evidence pointer>
- ⏸️ **AC-2** — <criterion> — <blocked: why, and what unblocks it>

## 📦 What changed

The substance of the deliverable: the plan, the diff summary, the review
findings, or the QA cases. Use clear subheadings and short lists. Keep prose
tight; an operator should grasp it by scanning headings.

## ⚠️ Risks and follow-ups

- ⚠️ <residual risk, stated plainly>
- ❓ <open question or unknown>

## Technical appendix

Machine-readable detail and structured blocks live here, out of the operator's
way. Embed JSON only where it adds precision.

```json
{
  "criteria": [
    {"id": "AC-1", "result": "pass", "evidence": ["path or observation"]}
  ],
  "metadata": {}
}
```
