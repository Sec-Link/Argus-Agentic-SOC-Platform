---
name: "Cloud IAM anomaly triage"
description: "Analyze suspicious cloud identity and access events, including role changes, new keys, unusual regions, and privilege escalation. Recommend evidence-preserving response actions."
---
# Cloud IAM anomaly triage

Analyze suspicious cloud identity and access events, including role changes, new keys, unusual regions, and privilege escalation. Recommend evidence-preserving response actions.

Output requirements:
- Cite observed evidence from the ticket.
- Mark unknown values as unavailable.
- Return structured JSON fields when requested.
- Do not change ticket status or execute commands.