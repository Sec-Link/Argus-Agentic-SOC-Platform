from __future__ import annotations

import uuid
from typing import Dict, Tuple


def build_critical_ticket_email_workflow_definition(recipient: str = 'achen@seclink.info') -> Tuple[Dict, Dict[str, str]]:
    start_id = str(uuid.uuid4())
    condition_id = str(uuid.uuid4())
    email_id = str(uuid.uuid4())
    end_id = str(uuid.uuid4())

    workflow_definition = {
        'id': str(uuid.uuid4()),
        'name': 'Critical Ticket Email Notification',
        'description': 'Send an email notification when a critical ticket is created.',
        'trigger_type': 'ticket_created',
        'tags': ['playbook', 'email', 'critical-ticket'],
        'steps': [
            {
                'id': start_id,
                'order': 0,
                'name': 'Start',
                'node_type': 'start',
                'node_category': 'control',
                'action_type': 'start',
                'action_config': {},
                'timeout_seconds': 30,
                'on_failure': 'stop',
                'retry_count': 0,
                'retry_delay_seconds': 0,
                'condition': {},
                'next_step_true': None,
                'next_step_false': None,
                'connections': [condition_id],
                'is_active': True,
            },
            {
                'id': condition_id,
                'order': 1,
                'name': 'Check Critical Priority',
                'node_type': 'condition',
                'node_category': 'control',
                'action_type': 'condition',
                'action_config': {},
                'timeout_seconds': 30,
                'on_failure': 'stop',
                'retry_count': 0,
                'retry_delay_seconds': 0,
                'condition': {
                    'field': '{{trigger_data.priority}}',
                    'operator': 'equals',
                    'value': 'critical',
                },
                'next_step_true': email_id,
                'next_step_false': end_id,
                'connections': [],
                'is_active': True,
            },
            {
                'id': email_id,
                'order': 2,
                'name': 'Send Critical Ticket Email',
                'node_type': 'action',
                'node_category': 'notification',
                'action_type': 'send_email',
                'action_config': {
                    'to': [recipient],
                    'subject': '[ECHO-SOC] Critical Ticket: {{trigger_data.title}}',
                    'body': (
                        'A critical ticket has been created.\n\n'
                        'Ticket Number: {{trigger_data.ticket_number}}\n'
                        'Title: {{trigger_data.title}}\n'
                        'Priority: {{trigger_data.priority}}\n'
                        'Description: {{trigger_data.description}}\n'
                    ),
                    'is_html': False,
                },
                'timeout_seconds': 60,
                'on_failure': 'stop',
                'retry_count': 1,
                'retry_delay_seconds': 1,
                'condition': {},
                'next_step_true': None,
                'next_step_false': None,
                'connections': [end_id],
                'is_active': True,
            },
            {
                'id': end_id,
                'order': 3,
                'name': 'End',
                'node_type': 'end',
                'node_category': 'control',
                'action_type': 'end',
                'action_config': {},
                'timeout_seconds': 30,
                'on_failure': 'stop',
                'retry_count': 0,
                'retry_delay_seconds': 0,
                'condition': {},
                'next_step_true': None,
                'next_step_false': None,
                'connections': [],
                'is_active': True,
            },
        ],
    }
    return workflow_definition, {'condition': condition_id, 'email': email_id}
