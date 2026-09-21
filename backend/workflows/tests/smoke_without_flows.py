"""Run the real Prefect/Django path in a disposable clone without workflows/flows.

From the repository root:
    .venv/Scripts/python.exe backend/workflows/tests/smoke_without_flows.py

Requires the installed project dependencies and permission to create PostgreSQL
test databases. Only a newly created test_workflows_smoke_* database and local
Prefect instance are changed; the source tree and configured services are untouched.
"""
import argparse
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4


def process_job(process):
    """Keep Windows venv launchers and their worker children in one owned job."""
    import ctypes

    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.restype = ctypes.c_void_p
    kernel.AssignProcessToJobObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel.TerminateJobObject.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    job = kernel.CreateJobObjectW(None, None)
    if not job or not kernel.AssignProcessToJobObject(job, int(process._handle)):
        process.kill()
        raise ctypes.WinError(ctypes.get_last_error())

    def terminate():
        try:
            if not kernel.TerminateJobObject(job, 1):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            kernel.CloseHandle(job)
    return terminate


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def main():
    import psycopg2
    from psycopg2 import sql
    import requests
    from cryptography.fernet import Fernet
    from dotenv import dotenv_values

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=int, default=180, help='Maximum seconds per service/run check.')
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[2]
    source_env = dotenv_values(source.parent / '.env')
    database = 'test_workflows_smoke_' + uuid4().hex[:10]
    assert database.startswith('test_workflows_smoke_')
    workspace = Path(tempfile.mkdtemp(prefix='argus-workflows-smoke-')).resolve()
    assert workspace.parent == Path(tempfile.gettempdir()).resolve()
    clone = workspace / 'project'
    clone_backend = clone / 'backend'
    processes, logs = [], []
    admin = None
    created = False
    succeeded = False
    env = {key: value for key, value in os.environ.items() if not key.startswith('PREFECT_')}
    for key in ('POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'POSTGRES_PORT'):
        if source_env.get(key) is not None:
            env[key] = source_env[key]
    api_port, django_port = free_port(), free_port()
    api_url = f'http://127.0.0.1:{api_port}/api'
    backend_url = f'http://127.0.0.1:{django_port}'
    env.update({
        'POSTGRES_DB': database, 'WORKFLOWS_TEST_DATABASE': database,
        'WORKFLOWS_USE_ISOLATED_DATABASE': '1', 'WORKFLOWS_TEST_PREFECT_URL': api_url,
        'DJANGO_SETTINGS_MODULE': 'workflows.tests.settings',
        'DEBUG': 'true', 'SECRET_KEY': secrets.token_urlsafe(40),
        'WORKFLOW_ENCRYPTION_KEYS': Fernet.generate_key().decode(),
        'BACKEND_ORIGIN': backend_url, 'PYTHONUNBUFFERED': '1',
        'PYTHONPATH': os.pathsep.join((str(clone), str(clone_backend))),
        'PREFECT_API_URL': api_url, 'PREFECT_API_KEY': '', 'PREFECT_API_AUTH_STRING': '',
        'PREFECT_HOME': str(workspace / 'prefect'),
        'PREFECT_PROFILES_PATH': str(workspace / 'profiles.toml'),
        'PREFECT_SERVER_MEMO_STORE_PATH': str(workspace / 'memo_store.toml'),
        'PREFECT_LOCAL_STORAGE_PATH': str(workspace / 'storage'),
        'PREFECT_SERVER_DATABASE_CONNECTION_URL': 'sqlite+aiosqlite:///' + (workspace / 'prefect.db').as_posix(),
        'PREFECT_SERVER_ANALYTICS_ENABLED': 'false',
        'PREFECT_SERVER_SERVICES_SCHEDULER_LOOP_SECONDS': '1',
        'PREFECT_SERVER_SERVICES_SCHEDULER_MAX_RUNS': '2',
        'PREFECT_SERVER_SERVICES_SCHEDULER_MIN_RUNS': '1',
        'PREFECT_WORKER_QUERY_SECONDS': '1', 'PREFECT_WORKER_PREFETCH_SECONDS': '1',
    })

    def run(arguments, name, background=False):
        log = (workspace / f'{name}.log').open('w', encoding='utf-8')
        logs.append(log)
        process = subprocess.Popen(
            [sys.executable, *arguments], cwd=clone, env=env,
            stdout=log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        process.smoke_stop = process.kill
        processes.append(process)
        process.smoke_stop = process_job(process) if os.name == 'nt' else process.terminate
        if not background:
            if process.wait(timeout=args.timeout):
                raise RuntimeError(f'{name} failed; inspect {workspace / (name + ".log")}')
        return process

    def stop(process):
        if process.smoke_stop:
            process.smoke_stop()
            process.smoke_stop = None
            process.wait(timeout=20)

    def wait_for(check, label):
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            result = check()
            if result:
                return result
            time.sleep(1)
        raise TimeoutError(f'{label} timed out; logs: {workspace}')

    def healthy(url):
        try:
            return requests.get(url, timeout=2).status_code < 500
        except requests.RequestException:
            return False

    try:
        print('Preparing an isolated database and source copy without workflows/flows.', flush=True)
        shutil.copytree(source, clone_backend, ignore=shutil.ignore_patterns(
            'flows', '__pycache__', 'staticfiles', 'media', '*.pyc', '.env',
        ))
        # All child interpreters reject file access or recreation under flows.
        (clone / 'sitecustomize.py').write_text(
            "import os, sys\n"
            "def forbid(event, args):\n"
            "    if event in ('open', 'os.mkdir', 'os.listdir', 'os.scandir', 'os.remove', 'os.rename'):\n"
            "        for path in args[:2] if event == 'os.rename' else args[:1]:\n"
            "            if isinstance(path, (str, bytes, os.PathLike)):\n"
            "                value = os.path.abspath(os.fsdecode(path)).replace(chr(92), '/').casefold()\n"
            "                if '/workflows/flows/' in value + '/':\n"
            "                    raise AssertionError('workflows/flows filesystem access is forbidden')\n"
            "sys.addaudithook(forbid)\n", encoding='utf-8',
        )
        assert not (clone_backend / 'workflows' / 'flows').exists()
        admin = psycopg2.connect(
            dbname='postgres', user=env.get('POSTGRES_USER', 'siem_user'),
            password=env.get('POSTGRES_PASSWORD', 'siem_password'),
            host=env.get('POSTGRES_HOST', 'localhost'), port=env.get('POSTGRES_PORT', '5432'),
        )
        admin.autocommit = True
        with admin.cursor() as cursor:
            cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
        created = True
        run(['backend/manage.py', 'migrate', '--noinput'], 'migrate')
        run(['-m', 'prefect', 'server', 'start', '--host', '127.0.0.1',
             '--port', str(api_port), '--analytics-off', '--no-ui'], 'prefect-server', True)
        wait_for(lambda: healthy(api_url + '/health'), 'Prefect server startup')
        run(['-m', 'prefect', 'work-pool', 'create', 'workflow-smoke', '--type', 'process', '--no-prompt'], 'pool')
        run(['-m', 'prefect', 'deploy', 'backend/workflows/prefect/flow.py:run_soar_workflow',
             '--name', 'workflow-smoke', '--pool', 'workflow-smoke', '--tag', 'soar', '--no-prompt'], 'deployment')

        # Import only copied Django code, with the database override already set.
        os.environ.clear()
        os.environ.update(env)
        sys.path[:0] = [str(clone_backend), str(clone)]
        import django
        django.setup()
        from django.conf import settings
        from django.contrib.auth import get_user_model
        from django.db import connections
        from rest_framework.authtoken.models import Token
        from workflows import prefect_client
        from workflows.deployment_registry import apply_deployment_snapshot
        from workflows.models import PrefectDeployment, WorkflowExecution
        assert Path(settings.BASE_DIR).resolve() == clone_backend
        assert settings.DATABASES['default']['NAME'] == database
        apply_deployment_snapshot(prefect_client.list_deployments())
        deployment = PrefectDeployment.objects.get(is_available=True)
        user = get_user_model().objects.create_user(username='flows-smoke', is_staff=True)
        token = Token.objects.create(user=user)
        client = requests.Session()
        client.headers['Authorization'] = 'Token ' + token.key

        def api(method, path, payload=None, expected=200):
            response = client.request(method, backend_url + '/api/v1/workflows/' + path,
                                      json=payload, timeout=30)
            if response.status_code != expected:
                raise RuntimeError(f'{method} {path}: expected {expected}, got {response.status_code}')
            return response.json() if response.content else None

        def services(suffix):
            consumer = run(['backend/manage.py', 'consume_prefect_events'], f'consumer-{suffix}', True)
            backend = run(['backend/manage.py', 'runserver', f'127.0.0.1:{django_port}', '--noreload'],
                          f'django-{suffix}', True)
            worker = run(['-m', 'prefect', 'worker', 'start', '--pool', 'workflow-smoke',
                          '--name', 'smoke-worker', '--limit', '1', '--install-policy', 'never'],
                         f'worker-{suffix}', True)
            wait_for(lambda: healthy(backend_url + '/api/v1/workflows/stats/'), 'Django startup')
            return consumer, backend, worker

        print('Starting real Django, Prefect worker and event consumer.', flush=True)
        active = services('first')
        workflow = api('POST', 'workflows/', {
            'name': 'No flows smoke', 'is_active': True, 'is_draft': True,
            'prefect_deployment_id': str(deployment.pk),
            'steps': [{'order': 0, 'name': 'Only log', 'action_type': 'log',
                       'action_config': {'message': 'no-flows-v1'}}],
        }, 201)
        workflow_id = workflow['id']
        workflow_path = f'workflows/{workflow_id}/'
        published = api('POST', workflow_path + 'publish/', {})
        assert published['manifest_path'] == ''
        exported = api('GET', workflow_path + 'export/')
        assert exported['_meta']['version'] == 1
        api('POST', 'import/', {'workflow_definition': exported, 'update_existing': False}, 201)
        api('PATCH', workflow_path, {'description': 'Saved but unpublished draft'})
        assert api('GET', workflow_path + 'export/')['description'] == exported['description']

        print('Restarting Django, consumer and worker with the database publication already present.', flush=True)
        for process in reversed(active):
            stop(process)
        active = services('restarted')
        assert api('GET', workflow_path)['published_version'] == 1
        manual = api('POST', workflow_path + 'execute/', {'trigger_source': 'smoke-manual'}, 201)

        def completed(source):
            run = WorkflowExecution.objects.filter(workflow_id=workflow_id, trigger_source=source).order_by('-created_at').first()
            if run and run.status in ('failed', 'cancelled'):
                raise RuntimeError(f'{source} execution ended {run.status}: {run.error_message}')
            if run and run.status == 'completed' and run.step_executions.filter(status='completed').exists():
                assert run.workflow_version == 1
                assert run.step_executions.get().output_data['message'] == 'no-flows-v1'
                return run
            return None

        manual_result = wait_for(lambda: completed('smoke-manual'), 'Manual run and event writeback')
        assert str(manual_result.pk) == manual['id']
        print('Manual run completed through the real worker and consumer; checking the scheduler.', flush=True)
        schedule = api('POST', 'schedules/', {
            'workflow': workflow_id, 'name': 'Smoke interval', 'schedule_type': 'interval',
            'interval_seconds': 30, 'trigger_source': 'smoke-schedule',
        }, 201)
        wait_for(lambda: completed('smoke-schedule'), 'Scheduled run and event writeback')
        api('POST', f'schedules/{schedule["id"]}/pause/', {})
        assert api('GET', f'schedules/{schedule["id"]}/')['sync_status'] == 'synced'
        assert not (clone_backend / 'workflows' / 'flows').exists()
        assert api('GET', workflow_path + 'export/')['_meta']['version'] == 1
        connections.close_all()
        succeeded = True
        print('PASS: no flows directory; restart, create/edit/publish/import/export, manual and scheduled runs, event writeback.', flush=True)
    finally:
        for process in reversed(processes):
            stop(process)
        for log in logs:
            log.close()
        if created:
            if 'django.db' in sys.modules:
                from django.db import connections
                connections.close_all()
            with admin.cursor() as cursor:
                cursor.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s', [database])
                cursor.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(database)))
        if admin is not None:
            admin.close()
        if succeeded:
            assert workspace.parent == Path(tempfile.gettempdir()).resolve()
            shutil.rmtree(workspace)
        else:
            print(f'Smoke logs retained at {workspace}; owned services/database stopped and removed.', flush=True)


if __name__ == '__main__':
    main()
