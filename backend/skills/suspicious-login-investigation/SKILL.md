---
name: "Suspicious login investigation"
description: "Investigate unusual authentication activity using source IP, account, time, geolocation, MFA, and privilege context. Recommend validation steps and avoid changing ticket status."
---
# Suspicious login investigation

Investigate unusual authentication activity using source IP, account, time, geolocation, MFA, and privilege context. Recommend validation steps and avoid changing ticket status.

Output requirements:
- Cite observed evidence from the ticket.
- Mark unknown values as unavailable.
- Return structured JSON fields when requested.
- Do not change ticket status or execute commands.