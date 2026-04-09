from django.core.management.base import BaseCommand
from orchestrator.tasks import run_due_tasks


class Command(BaseCommand):
    help = 'Enqueue due tasks using django.tasks'

    # 中文注释：
    # 简单命令：把到期任务交给 django.tasks 队列执行（不再阻塞轮询）。
    # 具体执行与排队逻辑在 orchestrator.tasks.run_due_tasks 中。

    def add_arguments(self, parser):
        parser.add_argument('--interval', type=int, default=30, help='Poll interval seconds')

    def handle(self, *args, **options):
        interval = options.get('interval', 30)
        job = run_due_tasks.enqueue(interval=interval)
        self.stdout.write(self.style.SUCCESS(f'Enqueued due tasks job: {job}'))
