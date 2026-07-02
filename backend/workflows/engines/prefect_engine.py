"""Prefect-backed workflow engine adapter.

Wraps :class:`workflows.engine.WorkflowEngine` in a Prefect ``@flow`` so
runs gain Prefect's observability features (UI timeline, retries, logging,
deployments, scheduling) without changing the step-execution logic.

Behaviour:

* If ``settings.PREFECT_API_URL`` is set, the flow run is registered with
  the configured Prefect server / Cloud workspace.
* If unset, Prefect 3.x runs ephemerally in-process — no server required.
* If the ``prefect`` package is not installed, importing this module raises
  ``ImportError``; the dispatcher in ``__init__`` catches that and falls
  back to the native engine.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Dict, Any

from prefect import flow, get_run_logger  # noqa: F401  (import side-effect: forces availability)

from .base import BaseEngine

if TYPE_CHECKING:
    from ..models import WorkflowExecution

logger = logging.getLogger(__name__)


class PrefectEngine(BaseEngine):
    name = 'prefect'

    def run(self, execution: "WorkflowExecution") -> Dict[str, Any]:
        from ..engine import WorkflowEngine

        flow_name = f"workflow:{execution.workflow.name}"

        @flow(name=flow_name, log_prints=False)
        def _prefect_flow(execution_id: str) -> Dict[str, Any]:
            run_logger = get_run_logger()
            run_logger.info("Prefect engine running execution %s", execution_id)
            return WorkflowEngine(execution).run()

        return _prefect_flow(str(execution.id))
