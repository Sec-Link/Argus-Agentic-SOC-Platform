"""Common interface for workflow execution engines."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Dict, Any

if TYPE_CHECKING:
    from ..models import WorkflowExecution


class BaseEngine(ABC):
    """Abstract base for workflow execution engines.

    Implementations must update *execution* in place — status, timestamps,
    progress, and per-step records — and return the final context dict.
    """

    name: str = 'base'

    @abstractmethod
    def run(self, execution: "WorkflowExecution") -> Dict[str, Any]:
        ...
