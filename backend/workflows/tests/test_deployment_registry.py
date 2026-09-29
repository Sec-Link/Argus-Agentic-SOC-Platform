import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.test import SimpleTestCase, TestCase

from workflows.deployment_registry import (
    DEPLOYMENT_EVENT_NAMES, GENERIC_ENTRYPOINT, apply_deployment_snapshot, require_deployment,
)
from workflows.models import PrefectDeployment
from workflows.prefect_events import EVENT_NAMES


def deployment(**overrides):
    return {
        'id': str(uuid4()), 'name': 'SOAR', 'tags': ['soar'],
        'entrypoint': GENERIC_ENTRYPOINT, 'work_pool_name': 'pool',
        'work_queue_name': 'default', 'status': 'READY', **overrides,
    }


class DeploymentRegistryTests(TestCase):
    def test_snapshot_upserts_compatible_targets_and_preserves_missing_bindings(self):
        first = deployment()
        second = deployment(name='Offline', status='NOT_READY', entrypoint=GENERIC_ENTRYPOINT.replace('/', '\\'))
        ignored = deployment(tags=[])
        apply_deployment_snapshot([first, second, ignored])
        self.assertEqual(PrefectDeployment.objects.count(), 2)
        self.assertEqual(require_deployment(second['id']), second['id'])
        first.update(name='Renamed', work_pool_name='new-pool')
        apply_deployment_snapshot([first])
        registered = PrefectDeployment.objects.get(pk=first['id'])
        self.assertEqual((registered.name, registered.work_pool_name), ('Renamed', 'new-pool'))
        self.assertFalse(PrefectDeployment.objects.get(pk=second['id']).is_available)
        with self.assertRaises(ValueError):
            require_deployment(second['id'])
        first['entrypoint'] = 'other.py:run'
        apply_deployment_snapshot([first])
        self.assertFalse(PrefectDeployment.objects.get(pk=first['id']).is_available)

    def test_malformed_snapshots_leave_existing_rows_untouched(self):
        existing = PrefectDeployment.objects.create(id=uuid4(), name='Keep')
        good = deployment()
        for snapshot in (None, {}, [good, {}], [good, good], [good, deployment(tags='soar')], [good, deployment(name=None)]):
            with self.subTest(snapshot=snapshot), self.assertRaises(ValueError):
                apply_deployment_snapshot(snapshot)
            existing.refresh_from_db()
            self.assertTrue(existing.is_available)
            self.assertEqual(PrefectDeployment.objects.count(), 1)

    def test_binding_requires_a_registered_uuid_and_never_chooses_another_target(self):
        PrefectDeployment.objects.create(id=uuid4(), name='Available')
        for value in ('', 'not-a-uuid', str(uuid4())):
            with self.subTest(value=value), self.assertRaises(ValueError):
                require_deployment(value)


class DeploymentConsumerTests(SimpleTestCase):
    def test_deployment_events_wake_refresh_without_entering_progress_checkpoint(self):
        from workflows.event_consumer import subscribe

        progress = SimpleNamespace(event=EVENT_NAMES[0])

        async def events():
            yield SimpleNamespace(event=DEPLOYMENT_EVENT_NAMES[0])
            yield progress
            raise asyncio.CancelledError

        @asynccontextmanager
        async def subscriber(**kwargs):
            self.assertEqual(kwargs['filter'].event.name, EVENT_NAMES + DEPLOYMENT_EVENT_NAMES)
            yield events()

        async def scenario():
            refresh = asyncio.Event()
            with self.assertRaises(asyncio.CancelledError):
                await subscribe(object(), refresh)
            self.assertTrue(refresh.is_set())

        with patch('prefect.events.clients.get_events_subscriber', side_effect=subscriber), \
                patch('workflows.event_consumer.replay_events') as replay, \
                patch('workflows.event_consumer.consume_event') as consume, \
                patch('workflows.event_consumer._guarded_call', side_effect=lambda leader, fn, *args: fn(*args)):
            asyncio.run(scenario())
        consume.assert_called_once_with(progress)
        replay.assert_called_once()

    def test_periodic_refresh_repairs_an_event_seen_before_commit(self):
        from workflows.event_consumer import refresh_deployments

        current = deployment()

        async def scenario():
            refreshed = asyncio.Event()
            refresh = asyncio.Event()
            refresh.set()
            snapshots = []
            loop = asyncio.get_running_loop()

            def apply(leader, fn, snapshot):
                snapshots.append(snapshot)
                if len(snapshots) == 2:
                    loop.call_soon_threadsafe(refreshed.set)

            with patch('workflows.event_consumer.DEPLOYMENT_REFRESH_SECONDS', 0.01), \
                    patch('workflows.event_consumer.prefect_client.list_deployments', side_effect=[[], [current]]), \
                    patch('workflows.event_consumer._guarded_call', side_effect=apply):
                task = asyncio.create_task(refresh_deployments(object(), refresh))
                try:
                    await asyncio.wait_for(refreshed.wait(), 2)
                finally:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
            self.assertEqual(snapshots, [[], [current]])

        asyncio.run(scenario())
