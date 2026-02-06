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


class TestExpandClearSequences:
    """Tests for expand_clear_sequences (Ink partial clear fix)."""

    def test_no_clear_sequences(self):
        """Data without EL2+CUU1 runs is returned unchanged."""
        screen = AltScreen(80, 24)
        data = b"Hello world\r\n"
        assert screen.expand_clear_sequences(data) == data

    def test_short_clear_not_expanded(self):
        """Runs of fewer than 3 EL2+CUU1 pairs are not modified."""
        screen = AltScreen(80, 24)
        data = b"\x1b[2K\x1b[1A\x1b[2K\x1b[1A"  # 2 pairs
        assert screen.expand_clear_sequences(data) == data

    def test_full_clear_not_expanded(self):
        """A clear that already reaches row 0 is not extended."""
        screen = AltScreen(80, 24)
        stream = pyte.ByteStream(screen)
        # Put cursor at row 5
        stream.feed(b"\r\n" * 5)
        assert screen.cursor.y == 5

        # 5-pair clear already covers rows 5 down to 0
        data = b"\x1b[2K\x1b[1A" * 5
        result = screen.expand_clear_sequences(data)
        assert result == data

    def test_partial_clear_is_extended(self):
        """A partial clear that doesn't reach row 0 gets extended."""
        screen = AltScreen(80, 24)
        stream = pyte.ByteStream(screen)
        # Draw content to push cursor to row 20
        for i in range(20):
            stream.feed(f"Line {i}\r\n".encode())
        assert screen.cursor.y == 20

        # Only clear 5 lines (should extend to clear all 20)
        data = b"\x1b[2K\x1b[1A" * 5
        result = screen.expand_clear_sequences(data)
        expected_pairs = 20  # extend from 5 to 20
        assert result.count(b"\x1b[2K\x1b[1A") == expected_pairs

    def test_partial_clear_produces_correct_screen(self):
        """Simulates Ink /clear: partial clear + redraw leaves clean screen."""
        screen = AltScreen(80, 24)
        stream = pyte.ByteStream(screen)

        # Draw 15 lines of content (Ink frame 1)
        for i in range(15):
            stream.feed(f"Old line {i}\r\n".encode())

        # Ink /clear: only clears 5 lines then redraws fresh prompt
        clear = b"\x1b[2K\x1b[1A" * 5 + b"\x1b[2K\x1b[G"
        new_content = b"Fresh prompt\r\n"

        expanded = screen.expand_clear_sequences(clear)
        stream.feed(expanded)
        stream.feed(new_content)

        # Old content should be gone
        non_empty = [line.rstrip() for line in screen.display if line.strip()]
        assert len(non_empty) == 1
        assert non_empty[0] == "Fresh prompt"

    def test_data_around_clear_preserved(self):
        """Text before and after a clear run is preserved."""
        screen = AltScreen(80, 24)
        stream = pyte.ByteStream(screen)
        stream.feed(b"\r\n" * 10)

        data = b"before\x1b[2K\x1b[1A" * 0 + b"before" + b"\x1b[2K\x1b[1A" * 5 + b"after"
        result = screen.expand_clear_sequences(data)
        assert result.startswith(b"before")
        assert result.endswith(b"after")


class TestScrollUpDown:
    """Tests for CSI S (SU) and CSI T (SD) support."""

    def test_scroll_up_basic(self):
        """CSI S scrolls content up, adding blank lines at bottom."""
        screen = AltScreen(40, 10)
        stream = pyte.ByteStream(screen)
        for i in range(10):
            stream.feed(f"Line {i}\r\n".encode())

        # After writing, Line 0 already scrolled off; rows 0-8 have Lines 1-9
        # Scroll up 3 more lines
        stream.feed(b"\x1b[3S")

        assert "Line 4" in screen.display[0]
        assert "Line 9" in screen.display[5]
        assert screen.display[6].strip() == ""

    def test_scroll_up_default_one(self):
        """CSI S with no parameter defaults to 1 line."""
        screen = AltScreen(40, 5)
        stream = pyte.ByteStream(screen)
        for i in range(5):
            stream.feed(f"L{i}\r\n".encode())

        stream.feed(b"\x1b[S")
        assert "L1" in screen.display[0]

    def test_scroll_down_basic(self):
        """CSI T scrolls content down, adding blank lines at top."""
        screen = AltScreen(40, 10)
        stream = pyte.ByteStream(screen)
        for i in range(10):
            stream.feed(f"Line {i}\r\n".encode())

        stream.feed(b"\x1b[3T")

        assert screen.display[0].strip() == ""
        assert screen.display[2].strip() == ""
        assert "Line 1" in screen.display[3]

    def test_scroll_up_with_margins(self):
        """SU respects the scroll region set by DECSTBM."""
        screen = AltScreen(40, 10)
        stream = pyte.ByteStream(screen)
        for i in range(10):
            stream.feed(f"Row {i}\r\n".encode())

        # After writing, rows 0-8 have Row 1..Row 9
        # Set scroll region to rows 3-7 (1-based: 4;8)
        stream.feed(b"\x1b[4;8r")
        stream.feed(b"\x1b[2S")

        # Rows outside the region should be unchanged
        assert "Row 1" in screen.display[0]
        assert "Row 2" in screen.display[1]
        assert "Row 3" in screen.display[2]
        # Rows inside the region shifted up by 2
        assert "Row 6" in screen.display[3]

    def test_scroll_up_clears_ghost_content(self):
        """Simulates tmux sending SU during Ink /clear — ghost content is eliminated."""
        screen = AltScreen(80, 24)
        stream = pyte.ByteStream(screen)

        # Fill screen with "old" content
        for i in range(24):
            stream.feed(f"Old line {i}\r\n".encode())

        non_empty_before = sum(1 for line in screen.display if line.strip())
        assert non_empty_before > 15

        # Simulate tmux clear: set margins, scroll up, reset margins
        stream.feed(b"\x1b[1;23r")   # Set scroll region
        stream.feed(b"\x1b[20S")     # Scroll up 20 lines
        stream.feed(b"\x1b[r")       # Reset scroll region

        non_empty_after = sum(1 for line in screen.display if line.strip())
        assert non_empty_after <= 5, f"Expected <= 5 non-empty lines, got {non_empty_after}"

    def test_scroll_up_cursor_unchanged(self):
        """SU does not move the cursor position."""
        screen = AltScreen(40, 10)
        stream = pyte.ByteStream(screen)
        stream.feed(b"\x1b[5;10H")  # Move cursor to row 5, col 10

        saved_y, saved_x = screen.cursor.y, screen.cursor.x
        stream.feed(b"\x1b[3S")

        assert screen.cursor.y == saved_y
        assert screen.cursor.x == saved_x
