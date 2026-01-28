"""Pytest configuration and fixtures for webterm tests."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock

import pytest

from webterm.config import App, Config
from webterm.local_server import LocalServer
from webterm.poller import Poller
from webterm.session_manager import SessionManager

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Generator
    from pathlib import Path


@pytest.fixture
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def sample_terminal_app() -> App:
    """Create a sample terminal app configuration."""
    return App(
        name="Test Terminal",
        slug="test-terminal",
        terminal=True,
        command="echo hello",
    )


@pytest.fixture
def sample_config(sample_terminal_app: App) -> Config:
    """Create a sample configuration with a terminal app."""
    return Config(apps=[sample_terminal_app])


@pytest.fixture
def tmp_config_path(tmp_path: Path) -> Path:
    """Create a temporary config path."""
    return tmp_path / "config"


@pytest.fixture
def mock_request() -> MagicMock:
    """Create a mock request with common attributes."""
    request = MagicMock()
    request.headers = {}
    request.secure = False
    request.query = {}
    return request


@pytest.fixture
def screen_buffer_factory():
    def _make(rows: list[str], width: int = 80):
        return [
            [
                {
                    "data": c,
                    "fg": "default",
                    "bg": "default",
                    "bold": False,
                    "italics": False,
                    "underscore": False,
                    "reverse": False,
                }
                for c in (row + " " * width)[:width]
            ]
            for row in rows
        ]

    return _make


@pytest.fixture
def mock_session():
    session = MagicMock()
    session.get_screen_has_changes = AsyncMock(return_value=False)
    session.get_screen_state = AsyncMock(return_value=(80, 24, [], True))
    session.get_screen_snapshot = AsyncMock(return_value=(80, 24, [], True))
    return session


@pytest.fixture
def poller() -> Poller:
    """Create a Poller instance."""
    return Poller()


@pytest.fixture
def mock_poller() -> MagicMock:
    """Create a mock Poller for unit tests."""
    return MagicMock()


class DummyAsyncLock:
    """A dummy async context manager for replacing locks in tests."""

    async def __aenter__(self):
        return None

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.fixture
def dummy_lock() -> DummyAsyncLock:
    """Create a dummy async lock for tests."""
    return DummyAsyncLock()


@pytest.fixture
def mock_screen_char():
    """Factory for creating mock pyte screen characters."""

    def _make(
        data: str = " ",
        fg: int = 0,
        bg: int = 0,
        bold: bool = False,
        italics: bool = False,
        underscore: bool = False,
        reverse: bool = False,
    ) -> MagicMock:
        char = MagicMock()
        char.data = data
        char.fg = fg
        char.bg = bg
        char.bold = bold
        char.italics = italics
        char.underscore = underscore
        char.reverse = reverse
        return char

    return _make


@pytest.fixture
def session_manager(poller: Poller, tmp_path: Path, sample_terminal_app: App) -> SessionManager:
    """Create a SessionManager instance."""
    return SessionManager(poller, tmp_path, [sample_terminal_app])


@pytest.fixture
async def local_server(
    tmp_config_path: Path, sample_config: Config
) -> AsyncGenerator[LocalServer, None]:
    """Create a LocalServer instance for testing."""
    server = LocalServer(
        str(tmp_config_path),
        sample_config,
        host="127.0.0.1",
        port=0,  # Use random available port
    )
    yield server
    # Cleanup
    server.force_exit()
