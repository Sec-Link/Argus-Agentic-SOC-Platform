"""Native, in-process workflow engine adapter.

Delegates to :class:`workflows.engine.WorkflowEngine`, which is the
original step-by-step executor. Kept as a thin wrapper so callers can
treat all engines uniformly.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Dict, Any

from .base import BaseEngine

if TYPE_CHECKING:
    from ..models import WorkflowExecution


class NativeEngine(BaseEngine):
    name = 'native'

    def run(self, execution: "WorkflowExecution") -> Dict[str, Any]:
        from ..engine import WorkflowEngine
        return WorkflowEngine(execution).run()
