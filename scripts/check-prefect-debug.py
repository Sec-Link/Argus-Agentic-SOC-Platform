"""Read-only check of Full Stack's two worker routes against the local Prefect API."""

import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


def main():
    root = Path(__file__).resolve().parents[1]
    launch = json.loads((root / '.vscode' / 'launch.json').read_text(encoding='utf-8'))
    tasks = json.loads((root / '.vscode' / 'tasks.json').read_text(encoding='utf-8'))
    configs = {item['name']: item for item in launch['configurations']}
    full_stack = next(item for item in launch['compounds'] if item['name'] == 'Debug: Full Stack')
    preparation = next(item for item in tasks['tasks'] if item['label'] == full_stack['preLaunchTask'])
    assert '-WithSecondDeployment' in preparation['args']
    workers = [configs[name] for name in full_stack['configurations']
               if configs[name].get('args', [])[:2] == ['worker', 'start']]
    assert len(workers) == 2, 'Full Stack must launch two independent workers.'
    pools, names = set(), set()
    for worker in workers:
        args = worker['args']
        pool = args[args.index('--pool') + 1]
        pools.add(pool)
        names.add(args[args.index('--name') + 1])
        assert worker['subProcess'] is True, 'Flow child processes must support breakpoints.'
        api_url = worker['env']['PREFECT_API_URL']
        with urlopen(f'{api_url}/work_pools/{quote(pool, safe="")}', timeout=5) as response:
            assert json.load(response)['type'] == 'process'
        request = Request(f'{api_url}/deployments/filter', method='POST',
                          data=json.dumps({'work_pools': {'name': {'any_': [pool]}}, 'limit': 200}).encode(),
                          headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=5) as response:
            deployments = json.load(response)
        compatible = [item for item in deployments
                      if item.get('work_pool_name') == pool and 'soar' in item.get('tags', [])
                      and (item.get('entrypoint') or '').replace('\\', '/') ==
                      'backend/workflows/prefect/flow.py:run_soar_workflow']
        assert compatible, f'{pool} has no compatible SOAR deployment.'
        print(f'{pool}: {", ".join(item["name"] for item in compatible)}')
    assert len(pools) == len(names) == 2, 'Workers must have distinct names and work pools.'
    print('Full Stack deployment and worker configuration checks passed.')


if __name__ == '__main__':
    main()
