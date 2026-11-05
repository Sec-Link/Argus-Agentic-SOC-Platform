"""Safe handling of user-supplied category icons.

The upload is never stored or served as-is. It must be a small PNG/JPEG/WebP that Pillow can decode; the
decoded pixels are re-encoded as a tiny PNG, which drops metadata, embedded payloads and any active content
(SVG and GIF are rejected outright).
"""
import base64
import io

from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_BYTES = 256 * 1024
MAX_PIXELS = 4_000_000  # guards against decompression bombs before the image is decoded
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}
ICON_SIZE = 96


class IconError(ValueError):
    pass


def sanitize_icon(uploaded) -> bytes:
    """Return a re-encoded PNG (<= 96x96) for the uploaded file, or raise IconError."""
    if uploaded is None:
        raise IconError("No file uploaded.")
    if getattr(uploaded, "size", 0) > MAX_UPLOAD_BYTES:
        raise IconError("Icon is too large (max 256 KB).")
    raw = uploaded.read(MAX_UPLOAD_BYTES + 1)
    if not raw:
        raise IconError("The file is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise IconError("Icon is too large (max 256 KB).")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.format not in ALLOWED_FORMATS:
                raise IconError("Only PNG, JPEG or WebP images are allowed.")
            if img.width * img.height > MAX_PIXELS:
                raise IconError("Image dimensions are too large.")
            img.load()
            frame = img.convert("RGBA")
    except IconError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise IconError("The file is not a valid image.")
    frame.thumbnail((ICON_SIZE, ICON_SIZE))
    out = io.BytesIO()
    frame.save(out, format="PNG", optimize=True)
    return out.getvalue()


def icon_data_url(png_bytes):
    """data: URL for an already sanitized icon (None when no custom icon is set)."""
    if not png_bytes:
        return None
    return "data:image/png;base64," + base64.b64encode(bytes(png_bytes)).decode("ascii")
