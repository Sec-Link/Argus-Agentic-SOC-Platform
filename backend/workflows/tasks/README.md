# Prefect Tasks

This folder contains Prefect task wrappers for workflow nodes. Each task is a thin
adapter around the existing workflow action implementations so that individual
nodes appear in the Prefect UI with step-level status and logs.

## Modules

- `utility.py`: log, delay
- `notification.py`: send_email, send_webhook
- `ticketing.py`: create_ticket, update_ticket
- `threat_intel.py`: ip_lookup, hash_lookup
- `containment.py`: block_ip, disable_user
- `release.py`: release_ip, enable_user
- `condition.py`: condition evaluation (compute-only, branching handled by the flow)

