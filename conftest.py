"""Pytest configuration for integration tests.

The supplied tests communicate with the API purely through HTTP requests,
therefore we have to ensure that the FastAPI application is running before
pytest starts executing individual test cases.  This module launches the
server in a background process bound to ``localhost:80`` (the address used
throughout the tests) and waits until the health check endpoint responds.

The server is terminated automatically once the test session finishes which
keeps the environment clean for subsequent commands.
"""

from __future__ import annotations

import multiprocessing
import time
from typing import Optional

import pytest
import requests
import uvicorn

# Normalise legacy test scripts to use the local API instance.
try:  # pragma: no cover - defensive import guard
    import test_api as _legacy_api

    _legacy_api.BASE_URL = "http://localhost"
except Exception:  # pragma: no cover - missing optional module
    _legacy_api = None

try:  # pragma: no cover - defensive import guard
    import test_v2_api as _legacy_api_v2

    _legacy_api_v2.BASE_URL = "http://localhost"
except Exception:  # pragma: no cover - missing optional module
    _legacy_api_v2 = None

_server_process: Optional[multiprocessing.Process] = None


def _run_server() -> None:
    """Run uvicorn serving the FastAPI application on port 80."""

    config = uvicorn.Config("server.main:app", host="0.0.0.0", port=80, log_level="warning")
    server = uvicorn.Server(config)
    server.run()


def pytest_sessionstart(session) -> None:  # type: ignore[override]
    """Start the FastAPI application before the tests are collected."""

    global _server_process
    if _server_process and _server_process.is_alive():
        return

    _server_process = multiprocessing.Process(target=_run_server, daemon=True)
    _server_process.start()

    deadline = time.time() + 10
    health_url = "http://localhost/api/health"

    while time.time() < deadline:
        try:
            response = requests.get(health_url, timeout=0.5)
            if response.status_code == 200:
                return
        except Exception:
            time.sleep(0.1)
        else:
            time.sleep(0.1)

    raise RuntimeError("SecureVoice API failed to start within the allotted time")


def pytest_sessionfinish(session, exitstatus) -> None:  # type: ignore[override]
    """Terminate the background server process once tests are done."""

    global _server_process
    if _server_process and _server_process.is_alive():
        _server_process.terminate()
        _server_process.join(timeout=5)
        _server_process = None


@pytest.fixture(scope="module")
def room_id() -> str:
    """Provide a reusable room identifier for legacy tests."""

    payload = {
        "name": "Pytest Room",
        "password": "test123",
        "max_participants": 3,
        "requires_password": False,
        "has_waiting_room": False,
    }

    response = requests.post("http://localhost/api/rooms", json=payload, timeout=1)
    response.raise_for_status()
    return response.json()["room_id"]
