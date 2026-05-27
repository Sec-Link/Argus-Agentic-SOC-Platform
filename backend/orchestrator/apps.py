from __future__ import annotations

import logging
import os
import sys
import threading
import time
from typing import Optional

from django.apps import AppConfig
from django.conf import settings
from django.db import connection

logger = logging.getLogger(__name__)

_POLLER_STARTED = False


class OrchestratorConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'orchestrator'

    def ready(self):
        global _POLLER_STARTED
        if _POLLER_STARTED:
            return

        # Avoid duplicate startup during Django autoreload parent process.
        if settings.DEBUG and os.environ.get('RUN_MAIN') != 'true':
            return

        # Avoid running poller for one-shot management commands.
        argv = ' '.join(sys.argv).lower()
        skip_cmd_markers = [
            'makemigrations',
            'migrate',
            'collectstatic',
            'shell',
            'createsuperuser',
            'test',
            'scheduler',
        ]
        if any(marker in argv for marker in skip_cmd_markers):
            return

        interval = max(1, int(getattr(settings, 'ORCHESTRATOR_SCHEDULE_INTERVAL_SECONDS', 30)))
        t = threading.Thread(target=_poller_loop, args=(interval,), name='orchestrator-poller', daemon=True)
        t.start()
        _POLLER_STARTED = True
        logger.info('orchestrator poller started in-process (interval=%ss)', interval)


def _pg_try_lock(lock_key: int) -> bool:
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_try_advisory_lock(%s)', [lock_key])
        row = cursor.fetchone()
    return bool(row and row[0])


def _pg_unlock(lock_key: int) -> None:
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_unlock(%s)', [lock_key])


def _run_due_once() -> Optional[dict]:
    from .tasks import run_due_tasks_sync

    # Postgres advisory lock avoids duplicate poller execution across workers.
    db_engine = (settings.DATABASES.get('default', {}) or {}).get('ENGINE', '') or ''
    lock_key = 90817263

    if 'postgresql' not in db_engine:
        return run_due_tasks_sync()

    got_lock = False
    try:
        got_lock = _pg_try_lock(lock_key)
        if not got_lock:
            return {'status': 'skipped', 'reason': 'lock_not_acquired'}
        return run_due_tasks_sync()
    finally:
        if got_lock:
            try:
                _pg_unlock(lock_key)
            except Exception:
                logger.exception('orchestrator poller: failed to release advisory lock')


def _poller_loop(interval_seconds: int) -> None:
    while True:
        try:
            result = _run_due_once()
            logger.debug('orchestrator poll result: %s', result)
        except Exception:
            logger.exception('orchestrator poller loop failure')
        time.sleep(interval_seconds)
