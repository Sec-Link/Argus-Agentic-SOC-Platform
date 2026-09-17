---
name: "DNS command and control investigation"
description: "Analyze suspicious DNS behavior such as high entropy, beaconing, rare domains, unusual record types, and query volume. Distinguish indicators from confirmed C2 and recommend safe validation."
---
# DNS command and control investigation

Analyze suspicious DNS behavior such as high entropy, beaconing, rare domains, unusual record types, and query volume. Distinguish indicators from confirmed C2 and recommend safe validation.

Output requirements:
- Cite observed evidence from the ticket.
- Mark unknown values as unavailable.
- Return structured JSON fields when requested.
- Do not change ticket status or execute commands.