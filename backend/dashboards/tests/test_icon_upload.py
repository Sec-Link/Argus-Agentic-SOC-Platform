import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from PIL import Image

from dashboards.icon_upload import MAX_UPLOAD_BYTES, IconError, icon_data_url, sanitize_icon


def image_bytes(fmt="PNG", size=(300, 200), color=(10, 120, 200)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format=fmt)
    return buf.getvalue()


def upload(data, name="icon.png"):
    return SimpleUploadedFile(name, data, content_type="image/png")


class SanitizeIconTests(SimpleTestCase):
    def test_valid_formats_are_reencoded_to_small_png(self):
        for fmt in ("PNG", "JPEG", "WEBP"):
            with self.subTest(fmt=fmt):
                out = sanitize_icon(upload(image_bytes(fmt)))
                with Image.open(io.BytesIO(out)) as img:
                    self.assertEqual(img.format, "PNG")
                    self.assertLessEqual(max(img.size), 96)

    def test_svg_is_rejected(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        with self.assertRaises(IconError):
            sanitize_icon(upload(svg, "icon.svg"))

    def test_gif_is_rejected(self):
        with self.assertRaises(IconError):
            sanitize_icon(upload(image_bytes("GIF"), "icon.gif"))

    def test_extension_and_content_type_are_not_trusted(self):
        with self.assertRaises(IconError):
            sanitize_icon(upload(b"<?php echo 1; ?>", "icon.png"))

    def test_oversized_upload_is_rejected(self):
        with self.assertRaises(IconError):
            sanitize_icon(upload(b"\x89PNG" + b"0" * (MAX_UPLOAD_BYTES + 10)))

    def test_empty_and_missing_are_rejected(self):
        with self.assertRaises(IconError):
            sanitize_icon(upload(b""))
        with self.assertRaises(IconError):
            sanitize_icon(None)

    def test_metadata_is_stripped(self):
        buf = io.BytesIO()
        img = Image.new("RGB", (32, 32), (1, 2, 3))
        img.save(buf, format="PNG", pnginfo=_text_info("Comment", "secret-marker"))
        out = sanitize_icon(upload(buf.getvalue()))
        self.assertNotIn(b"secret-marker", out)

    def test_data_url(self):
        self.assertIsNone(icon_data_url(None))
        self.assertTrue(icon_data_url(b"abc").startswith("data:image/png;base64,"))


def _text_info(key, value):
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text(key, value)
    return info
