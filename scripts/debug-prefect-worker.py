"""Start a Prefect worker without hiding Flow Python processes behind cmd.exe."""

from __future__ import annotations

import sys
from typing import Any

from prefect.cli import app
from prefect.utilities import processutils


def _direct_prefect_engine(command: Any) -> Any:
    if isinstance(command, str):
        argv = processutils._split_windows_command_string(command)
        if argv[1:3] == ["-m", "prefect.engine"]:
            return argv
    return command


if sys.platform == "win32":
    _open_process = processutils._open_anyio_process

    async def _open_debuggable_process(command: Any, **kwargs: Any):
        return await _open_process(_direct_prefect_engine(command), **kwargs)

    processutils._open_anyio_process = _open_debuggable_process


if __name__ == "__main__":
    app()
