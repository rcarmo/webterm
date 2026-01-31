"""Tests for the AltScreen class with alternate screen buffer support."""

import pyte
import pytest

from webterm.alt_screen import DECALTBUF, DECALTBUF_1047, DECALTBUF_1048, AltScreen


class TestAltScreen:
    """Tests for AltScreen alternate buffer support."""

    def test_basic_screen_operations(self):
        """Test that basic screen operations still work."""
        screen = AltScreen(40, 10)
        stream = pyte.Stream(screen)

        stream.feed("Hello World\r\n")
        stream.feed("Line 2")

        assert "Hello World" in screen.display[0]
        assert "Line 2" in screen.display[1]

    def test_alternate_screen_save_restore(self):
        """Test DECSET/DECRST 1049 saves and restores main screen."""
        screen = AltScreen(40, 10)
        stream = pyte.Stream(screen)

        # Write to main screen
        stream.feed("MAIN SCREEN LINE 1\r\n")
        stream.feed("MAIN SCREEN LINE 2\r\n")
        assert "MAIN SCREEN LINE 1" in screen.display[0]
        assert "MAIN SCREEN LINE 2" in screen.display[1]

        # Enter alternate screen (DECSET 1049)
        stream.feed("\x1b[?1049h")
        # Screen should be cleared
        assert screen.display[0].strip() == ""
        assert screen.display[1].strip() == ""

        # Write to alternate screen
        stream.feed("ALT SCREEN CONTENT\r\n")
        assert "ALT SCREEN CONTENT" in screen.display[0]

        # Exit alternate screen (DECRST 1049)
        stream.feed("\x1b[?1049l")
        # Main screen should be restored
        assert "MAIN SCREEN LINE 1" in screen.display[0]
        assert "MAIN SCREEN LINE 2" in screen.display[1]

    def test_alternate_screen_mode_flag(self):
        """Test that DECALTBUF mode flag is set correctly."""
        screen = AltScreen(40, 10)
        stream = pyte.Stream(screen)

        assert DECALTBUF not in screen.mode

        stream.feed("\x1b[?1049h")
        assert DECALTBUF in screen.mode

        stream.feed("\x1b[?1049l")
        assert DECALTBUF not in screen.mode

    @pytest.mark.parametrize(
        ("enter_seq", "exit_seq", "mode_flag"),
        [
            ("\x1b[?1047h", "\x1b[?1047l", DECALTBUF_1047),
            ("\x1b[?1048h", "\x1b[?1048l", DECALTBUF_1048),
        ],
    )
    def test_alternate_screen_mode_variants(self, enter_seq, exit_seq, mode_flag):
        """Test that DECSET/DECRST 1047/1048 trigger alternate buffer handling."""
        screen = AltScreen(40, 10)
        stream = pyte.Stream(screen)

        stream.feed("MAIN SCREEN\r\n")
        assert "MAIN SCREEN" in screen.display[0]

        stream.feed(enter_seq)
        assert mode_flag in screen.mode
        assert screen.display[0].strip() == ""

        stream.feed("ALT BUFFER\r\n")
        assert "ALT BUFFER" in screen.display[0]

        stream.feed(exit_seq)
        assert mode_flag not in screen.mode
        assert "MAIN SCREEN" in screen.display[0]

    def test_multiple_alt_screen_switches(self):
        """Test multiple switches between main and alternate screen."""
        screen = AltScreen(40, 10)
        stream = pyte.Stream(screen)

        # Main content
        stream.feed("MAIN 1\r\n")
        stream.feed("\x1b[?1049h")  # Enter alt
        stream.feed("ALT 1\r\n")
        stream.feed("\x1b[?1049l")  # Exit alt
        assert "MAIN 1" in screen.display[0]

        # More main content
        stream.feed("MAIN 2\r\n")
        stream.feed("\x1b[?1049h")  # Enter alt again
        assert screen.display[0].strip() == ""  # Alt screen is clear
        stream.feed("\x1b[?1049l")  # Exit alt
        assert "MAIN 1" in screen.display[0]
        assert "MAIN 2" in screen.display[1]

    def test_resize_invalidates_saved_buffer(self):
        """Test that resizing clears the saved alternate screen buffer."""
        screen = AltScreen(40, 10)
        stream = pyte.Stream(screen)

        stream.feed("MAIN CONTENT\r\n")
        stream.feed("\x1b[?1049h")  # Enter alt
        assert screen._saved_buffer is not None

        # Resize while in alt mode
        screen.resize(20, 80)
        assert screen._saved_buffer is None

    def test_ed_clear_still_works(self):
        """Test that explicit ED (erase display) still works."""
        screen = AltScreen(40, 10)
        stream = pyte.Stream(screen)

        stream.feed("Line 1\r\n")
        stream.feed("Line 2\r\n")
        stream.feed("\x1b[2J")  # ED 2 - erase entire display

        assert all(line.strip() == "" for line in screen.display)
