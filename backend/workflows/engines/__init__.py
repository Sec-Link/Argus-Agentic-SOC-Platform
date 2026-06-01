"""
Workflow engine selection layer.

The platform supports two interchangeable execution backends:

* :class:`NativeEngine` — runs steps in-process via the existing
  :class:`workflows.engine.WorkflowEngine`. Zero external dependencies.
* :class:`PrefectEngine` — wraps the same step logic in a Prefect flow.
  When ``PREFECT_API_URL`` is set, runs become visible in Prefect's UI;
  otherwise Prefect runs ephemerally with no extra services.

Both engines accept a :class:`workflows.models.WorkflowExecution` and update
its status/results identically. The choice is made by ``get_engine_for()``,
which honours per-workflow ``engine_type`` first, then
``settings.WORKFLOW_ENGINE_DEFAULT``.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from django.conf import settings

from .base import BaseEngine
from .native import NativeEngine

if TYPE_CHECKING:
    from workflows.models import Workflow, WorkflowExecution

logger = logging.getLogger(__name__)


def get_engine_for(workflow: "Workflow") -> BaseEngine:
    """
    Resolve the engine instance to use for *workflow*.

    Resolution order:
      1. ``workflow.engine_type`` if non-empty.
      2. ``settings.WORKFLOW_ENGINE_DEFAULT`` (falls back to ``"native"``).
    """
    engine_type = (getattr(workflow, 'engine_type', '') or '').strip().lower()
    if not engine_type:
        engine_type = (getattr(settings, 'WORKFLOW_ENGINE_DEFAULT', 'native') or 'native').lower()

    if engine_type == 'prefect':
        try:
            from .prefect_engine import PrefectEngine
            return PrefectEngine()
        except Exception as exc:
            logger.warning(
                "Prefect engine unavailable (%s); falling back to native.", exc
            )
            return NativeEngine()

    return NativeEngine()


def run_execution(execution: "WorkflowExecution") -> dict:
    """Run *execution* using the engine resolved for its workflow."""
    engine = get_engine_for(execution.workflow)
    logger.info(
        "Running execution %s with engine %s",
        execution.id,
        engine.__class__.__name__,
    )
    return engine.run(execution)


__all__ = ['BaseEngine', 'NativeEngine', 'get_engine_for', 'run_execution']
