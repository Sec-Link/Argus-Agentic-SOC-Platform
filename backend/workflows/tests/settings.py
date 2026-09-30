"""PostgreSQL workflow checks without contacting the configured Prefect server."""
import os

os.environ['PREFECT_API_URL'] = os.getenv('WORKFLOWS_TEST_PREFECT_URL', '')
os.environ['PREFECT_API_KEY'] = ''
os.environ['PREFECT_API_AUTH_STRING'] = ''

from siem_project.settings import *  # noqa: F403,E402

test_database = os.getenv('WORKFLOWS_TEST_DATABASE', 'test_workflows_manifests')
if not test_database.startswith('test_workflows_'):
    raise ValueError('WORKFLOWS_TEST_DATABASE must start with test_workflows_.')
DATABASES['default']['TEST'] = {'NAME': test_database}  # noqa: F405
if os.getenv('WORKFLOWS_USE_ISOLATED_DATABASE') == '1':
    DATABASES['default']['NAME'] = test_database  # noqa: F405
ALLOWED_HOSTS = ['testserver', 'localhost', '127.0.0.1']
SECURE_SSL_REDIRECT = False
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
