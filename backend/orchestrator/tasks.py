import logging
from datetime import timedelta
from django.conf import settings
from django.utils import timezone
from django.tasks import task
from django_scheduled_tasks import periodic_task
from .models import Task
from .utils import execute_task

try:
    from croniter import croniter
except Exception:
    croniter = None

logger = logging.getLogger(__name__)


@task
def execute_task_async(task_id: str):
    task_obj = Task.objects.filter(id=task_id).first()
    if not task_obj:
        logger.warning("execute_task_async: task not found id=%s", task_id)
        return {"status": "missing", "task_id": task_id}
    run = execute_task(task_obj)
    return {"status": "ok", "task_id": task_id, "run_id": str(run.id)}


_SCHEDULE_INTERVAL = max(1, int(getattr(settings, "ORCHESTRATOR_SCHEDULE_INTERVAL_SECONDS", 30)))


@periodic_task(
    interval=timedelta(seconds=_SCHEDULE_INTERVAL),
    name="orchestrator.run_due_tasks",
)
@task
def run_due_tasks():
    if croniter is None:
        logger.error("run_due_tasks: croniter not installed")
        return {"status": "error", "message": "croniter not installed"}

    now = timezone.now()
    enqueued = 0
    errors = 0

    for t in Task.objects.all():
        try:
            base = now
            it = croniter(t.schedule, base)
            prev = it.get_prev(ret_type=timezone.datetime)
            prev_dt = prev if isinstance(prev, timezone.datetime) else timezone.make_aware(prev)
            delta = now - prev_dt
            if delta.total_seconds() <= _SCHEDULE_INTERVAL:
                execute_task_async.enqueue(task_id=str(t.id))
                enqueued += 1
        except Exception as exc:
            logger.exception("run_due_tasks: error evaluating task id=%s: %s", t.id, exc)
            errors += 1

    return {"status": "ok", "enqueued": enqueued, "errors": errors}
