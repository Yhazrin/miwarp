---
name: project-status-dashboard
description: Build a concise project status dashboard
category: productivity
icon: 🎯
---

# Project Status Dashboard

Report the decision-relevant facts first: overall status, completed outcomes, current blockers, next milestone, and evidence.

Use `miwarp-progress` for bounded phases:

```miwarp-progress
{"title":"v1.0.9 delivery","summary":"Core reliability is complete; experience work is active.","items":[{"label":"Send transactions","status":"done","progress":100},{"label":"Runtime Hub","status":"active","progress":55},{"label":"Release validation","status":"pending","progress":10}]}
```

Use `miwarp-timeline` for dated events or ordered handoffs:

```miwarp-timeline
{"title":"Next handoffs","items":[{"title":"Freeze contracts","state":"done"},{"title":"Integrate feature branches","state":"active"},{"title":"Run release gates","state":"pending"}]}
```

Use at most twelve progress items. Distinguish measured completion from estimates and list unresolved risks in text.
