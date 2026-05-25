from django.core.management.base import BaseCommand
from orchestrator.tasks import run_due_tasks
import time


class Command(BaseCommand):
    help = 'Enqueue due tasks using django.tasks'

    # 中文注释：
    # 简单命令：把到期任务交给 django.tasks 队列执行（不再阻塞轮询）。
    # 具体执行与排队逻辑在 orchestrator.tasks.run_due_tasks 中。

    def add_arguments(self, parser):
        parser.add_argument('--interval', type=int, default=30, help='Poll interval seconds')
        parser.add_argument('--loop', action='store_true', help='Run continuously and enqueue due-task checks on each interval')

    def handle(self, *args, **options):
        interval = max(1, int(options.get('interval', 30)))
        loop = bool(options.get('loop'))

        if not loop:
            job = run_due_tasks.enqueue(interval=interval)
            self.stdout.write(self.style.SUCCESS(f'Enqueued due tasks job: {job}'))
            return

        self.stdout.write(self.style.SUCCESS(f'orchestrator scheduler loop started (interval={interval}s)'))
        try:
            while True:
                job = run_due_tasks.enqueue(interval=interval)
                self.stdout.write(f'Enqueued due tasks job: {job}')
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING('orchestrator scheduler loop stopped by user'))
