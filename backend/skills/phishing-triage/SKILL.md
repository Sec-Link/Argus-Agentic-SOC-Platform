---
name: "Phishing email triage"
description: "Analyze suspicious email indicators, sender authentication, URLs, attachments, user impact, and recommended containment. Never claim a link or attachment is malicious without evidence. Return concise findings and follow-up tasks."
---
# Phishing email triage

Analyze suspicious email indicators, sender authentication, URLs, attachments, user impact, and recommended containment. Never claim a link or attachment is malicious without evidence. Return concise findings and follow-up tasks.

Output requirements:
- Cite observed evidence from the ticket.
- Mark unknown values as unavailable.
- Return structured JSON fields when requested.
- Do not change ticket status or execute commands.