"""Tests for slugify module."""

from webterm.slugify import slugify


class TestSlugify:
    """Tests for the slugify function."""

    def test_lowercase(self):
        """Test that slugify converts to lowercase."""
        assert slugify("HelloWorld") == "helloworld"

    def test_spaces_to_dashes(self):
        """Test that spaces are converted to dashes."""
        assert slugify("hello world") == "hello-world"

    def test_multiple_spaces(self):
        """Test that multiple spaces become single dash."""
        assert slugify("hello   world") == "hello-world"

    def test_special_characters_removed(self):
        """Test that special characters are removed."""
        assert slugify("hello@world!") == "helloworld"

    def test_combined(self):
        """Test combination of transformations."""
        assert slugify("Hello World!") == "hello-world"

    def test_empty_string(self):
        """Test empty string."""
        assert slugify("") == ""

    def test_numbers_preserved(self):
        """Test that numbers are preserved."""
        assert slugify("test123") == "test123"

    def test_leading_trailing_spaces(self):
        """Test that leading/trailing spaces are handled."""
        result = slugify("  hello  ")
        assert "hello" in result

    def test_allow_unicode_preserves_unicode(self):
        """Test that allow_unicode=True preserves unicode characters."""
        # With allow_unicode=True, unicode chars are normalized but preserved
        result = slugify("héllo wörld", allow_unicode=True)
        assert result == "héllo-wörld"
        # Without allow_unicode (default), non-ASCII is transliterated
        result_ascii = slugify("héllo wörld", allow_unicode=False)
        assert result_ascii == "hello-world"
