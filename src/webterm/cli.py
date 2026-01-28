from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

import click
from importlib_metadata import PackageNotFoundError, version

from . import constants
from .local_server import LocalServer

FORMAT = "%(asctime)s %(levelname)s %(message)s"
logging.basicConfig(
    level="DEBUG" if constants.DEBUG else "INFO",
    format=FORMAT,
    datefmt="%X",
)

log = logging.getLogger("webterm")


def _package_version() -> str:
    try:
        return version("webterm")
    except PackageNotFoundError:
        return "0.0.0"


@click.command()
@click.version_option(_package_version())
@click.argument("command", required=False)
@click.option("--port", "-p", type=int, help="Port for server.", default=8080)
@click.option("--host", "-H", help="Host for server.", default="0.0.0.0")
@click.option(
    "--landing-manifest",
    "-L",
    "landing_manifest",
    type=click.Path(exists=True, dir_okay=False, readable=True, path_type=Path),
    help="YAML manifest describing landing page tiles (slug/name/command).",
)
@click.option(
    "--compose-manifest",
    "-C",
    "compose_manifest",
    type=click.Path(exists=True, dir_okay=False, readable=True, path_type=Path),
    help='Docker compose YAML; services with label "webterm-command" become landing tiles.',
)
@click.option(
    "--docker-watch",
    "-D",
    "docker_watch",
    is_flag=True,
    help='Watch Docker for containers with "webterm-command" label and add/remove sessions dynamically.',
)
@click.option(
    "--theme",
    "-t",
    help="Terminal color theme (xterm, monokai, dark, light, dracula, catppuccin, nord, gruvbox, solarized, tokyo).",
    default="xterm",
)
@click.option(
    "--font-family",
    "-f",
    help="Terminal font family (CSS font stack).",
    default=None,
)
@click.option(
    "--font-size",
    "-s",
    type=int,
    help="Terminal font size in pixels.",
    default=16,
)
def app(
    command: str | None,
    port: int,
    host: str,
    landing_manifest: Path | None,
    compose_manifest: Path | None,
    docker_watch: bool,
    theme: str,
    font_family: str | None,
    font_size: int,
) -> None:
    """Serve a terminal over HTTP/WebSocket.

    COMMAND: Shell command to run in terminal (default: $SHELL)

    Examples:

    \b
        webterm                           # Serve default shell
        webterm htop                      # Serve htop in terminal
        webterm --docker-watch            # Watch Docker for labeled containers
    """
    VERSION = _package_version()
    log.info("webterm v%s", VERSION)

    if constants.DEBUG:
        log.warning("DEBUG env var is set; logs may be verbose!")

    from .config import default_config, load_compose_manifest, load_landing_yaml

    _config = default_config()

    landing_apps: list = []
    is_compose_mode = False
    is_docker_watch_mode = docker_watch
    compose_project: str | None = None
    if landing_manifest:
        landing_apps = load_landing_yaml(landing_manifest)
    elif compose_manifest:
        landing_apps = load_compose_manifest(compose_manifest)
        is_compose_mode = True
        # Derive compose project name from directory (same as docker-compose default)
        compose_project = compose_manifest.parent.name

    server = LocalServer(
        "./",
        _config,
        host=host,
        port=port,
        landing_apps=landing_apps,
        compose_mode=is_compose_mode,
        compose_project=compose_project,
        docker_watch_mode=is_docker_watch_mode,
        theme=theme,
        font_family=font_family,
        font_size=font_size,
    )
    for app_entry in landing_apps:
        server.add_terminal(app_entry.name, app_entry.command, slug=app_entry.slug)
    if command:
        # Run command as terminal
        server.add_terminal("Terminal", command, "")
        log.info("Serving terminal: %s", command)
    elif docker_watch:
        # Docker watch mode - sessions added dynamically
        log.info("Docker watch mode enabled - sessions will be added dynamically")
    elif not landing_apps:
        # Run default shell
        terminal_command = os.environ.get("SHELL", "/bin/sh")
        server.add_terminal("Terminal", terminal_command, "")
        log.info("Serving terminal: %s", terminal_command)

    def _run_async():
        if constants.WINDOWS:
            asyncio.run(server.run())
        else:
            try:
                import uvloop
            except ImportError:
                asyncio.run(server.run())
            else:
                if sys.version_info >= (3, 11):
                    with asyncio.Runner(loop_factory=uvloop.new_event_loop) as runner:
                        runner.run(server.run())
                else:
                    uvloop.install()
                    asyncio.run(server.run())

    _run_async()


if __name__ == "__main__":
    app()
