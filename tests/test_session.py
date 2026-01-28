"""Tests for session management."""

from __future__ import annotations

import pytest

from webterm.session import Session, SessionConnector
from webterm.types import RouteKey, SessionID


class TestSessionConnector:
    """Tests for SessionConnector base class."""

    @pytest.mark.asyncio
    async def test_on_data_noop(self) -> None:
        """Default on_data does nothing."""
        connector = SessionConnector()
        await connector.on_data(b"test")  # Should not raise

    @pytest.mark.asyncio
    async def test_on_meta_noop(self) -> None:
        """Default on_meta does nothing."""
        connector = SessionConnector()
        await connector.on_meta({"key": "value"})  # Should not raise

    @pytest.mark.asyncio
    async def test_on_close_noop(self) -> None:
        """Default on_close does nothing."""
        connector = SessionConnector()
        await connector.on_close()  # Should not raise

    @pytest.mark.asyncio
    async def test_on_binary_encoded_message_noop(self) -> None:
        """Default on_binary_encoded_message does nothing."""
        connector = SessionConnector()
        await connector.on_binary_encoded_message(b"\x00\x01")  # Should not raise


class TestSessionBase:
    """Tests for Session base class."""

    def test_is_running_default(self) -> None:
        """Default is_running returns False."""
        # Session is abstract, but is_running has a default impl
        # We can test it via any concrete implementation, or check the code
        # For now just verify the base returns False
        assert Session.is_running(Session.__new__(Session)) is False


class TestTypes:
    """Tests for type definitions."""

    def test_session_id_is_string(self) -> None:
        """Test that SessionID is a string type."""
        session_id = SessionID("test-session-123")
        assert isinstance(session_id, str)
        assert session_id == "test-session-123"

    def test_route_key_is_string(self) -> None:
        """Test that RouteKey is a string type."""
        route_key = RouteKey("abc123")
        assert isinstance(route_key, str)
        assert route_key == "abc123"


class TestIdentity:
    """Tests for identity generation."""

    def test_generate_unique_ids(self) -> None:
        """Test that generated IDs are unique."""
        from webterm.identity import generate

        ids = [generate() for _ in range(100)]
        assert len(set(ids)) == 100  # All unique

    def test_generate_id_format(self) -> None:
        """Test that generated IDs have expected format."""
        from webterm.identity import generate

        id_ = generate()
        assert isinstance(id_, str)
        assert len(id_) > 0
