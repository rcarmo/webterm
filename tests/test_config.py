"""Tests for configuration handling."""

from __future__ import annotations

import pytest

from webterm.config import App, Config


class TestApp:
    """Tests for App configuration."""

    def test_create_terminal_app(self) -> None:
        """Test creating a terminal app configuration."""
        app = App(
            name="My Terminal",
            slug="my-terminal",
            terminal=True,
            command="bash",
        )
        assert app.name == "My Terminal"
        assert app.slug == "my-terminal"
        assert app.terminal is True
        assert app.command == "bash"

    def test_create_terminal_app_defaults(self) -> None:
        """Test creating a terminal app configuration with defaults."""
        app = App(
            name="My App",
            slug="my-app",
            command="bash",
        )
        assert app.terminal is False


class TestConfig:
    """Tests for Config."""

    def test_create_config_with_apps(self) -> None:
        """Test creating a config with apps."""
        app = App(name="Test", slug="test", terminal=True, command="bash")
        config = Config(apps=[app])
        assert len(config.apps) == 1
        assert config.apps[0].name == "Test"

    def test_create_empty_config(self) -> None:
        """Test creating a config with no apps."""
        config = Config(apps=[])
        assert len(config.apps) == 0


class TestDefaultConfig:
    """Tests for default_config function."""

    def test_default_config_returns_config(self):
        """Test that default_config returns a Config object."""
        from webterm.config import default_config

        config = default_config()
        assert config is not None
        assert hasattr(config, "apps")


class TestLoadConfig:
    """Tests for load_config function."""

    def test_load_config_parses_terminal_only(self, tmp_path):
        from webterm.config import load_config

        config_path = tmp_path / "config.toml"
        config_path.write_text(
            """
[terminal.shell]
command = "bash"
""".lstrip()
        )

        config = load_config(config_path)
        assert len(config.apps) == 1
        assert {a.name for a in config.apps} == {"shell"}
        assert any(a.terminal for a in config.apps)

    def test_load_config_rejects_app_entries(self, tmp_path):
        from webterm.config import load_config

        config_path = tmp_path / "config.toml"
        config_path.write_text(
            """
[app."My App"]
command = "echo hi"
""".lstrip()
        )
        with pytest.raises(ValueError):
            load_config(config_path)

    def test_load_config_expands_vars(self, tmp_path, monkeypatch):
        from webterm.config import load_config

        monkeypatch.setenv("MY_CMD", "echo expanded")
        config_path = tmp_path / "config.toml"
        config_path.write_text(
            """
[terminal.t]
command = "$MY_CMD"
""".lstrip()
        )
        config = load_config(config_path)
        assert config.apps[0].command == "echo expanded"
