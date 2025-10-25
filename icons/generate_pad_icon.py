#!/usr/bin/env python3
"""Generate Beatmaker pad-grid icons in multiple PNG sizes.

The repository intentionally stays binary-free. Run this script before
packaging the extension to emit PNG icons in the required dimensions.
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUTPUT_SIZES = (16, 32, 48, 128)
BASE_SIZE = 96.0
BACKGROUND = (5, 5, 5, 255)
SQUARE_COLOR = (216, 216, 216, 255)
TRIANGLE_COLOR = (245, 245, 245, 255)
SQUARE_COORDS = [
    (6.0, 6.0), (38.0, 6.0), (70.0, 6.0),
    (6.0, 38.0),               (70.0, 38.0),
    (6.0, 70.0), (38.0, 70.0), (70.0, 70.0),
]
SQUARE_SIZE = 20.0
SQUARE_RADIUS = 6.0
TRI_MARGIN = 3.0
TRIANGLE_POINTS = (
    (38.0 + TRI_MARGIN, 38.0 + TRI_MARGIN),
    (38.0 + TRI_MARGIN, 58.0 - TRI_MARGIN),
    (58.0 - TRI_MARGIN, 48.0),
)


def _sign(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    return (px - bx) * (ay - by) - (ax - bx) * (py - by)


def _point_in_triangle(px: float, py: float) -> bool:
    (ax, ay), (bx, by), (cx, cy) = TRIANGLE_POINTS
    b1 = _sign(px, py, ax, ay, bx, by) <= 0.0
    b2 = _sign(px, py, bx, by, cx, cy) <= 0.0
    b3 = _sign(px, py, cx, cy, ax, ay) <= 0.0
    return (b1 == b2) and (b2 == b3)


def _point_in_round_rect(px: float, py: float, rx: float, ry: float) -> bool:
    if not (rx <= px <= rx + SQUARE_SIZE and ry <= py <= ry + SQUARE_SIZE):
        return False
    dx = min(px - rx, rx + SQUARE_SIZE - px)
    dy = min(py - ry, ry + SQUARE_SIZE - py)
    if dx >= SQUARE_RADIUS or dy >= SQUARE_RADIUS:
        return True
    return (dx - SQUARE_RADIUS) ** 2 + (dy - SQUARE_RADIUS) ** 2 <= SQUARE_RADIUS ** 2


def _generate_pixels(size: int) -> list[list[tuple[int, int, int, int]]]:
    pixels = [[BACKGROUND for _ in range(size)] for _ in range(size)]
    for y in range(size):
        for x in range(size):
            base_x = (x + 0.5) / size * BASE_SIZE
            base_y = (y + 0.5) / size * BASE_SIZE
            if _point_in_triangle(base_x, base_y):
                pixels[y][x] = TRIANGLE_COLOR
                continue
            for rx, ry in SQUARE_COORDS:
                if _point_in_round_rect(base_x, base_y, rx, ry):
                    pixels[y][x] = SQUARE_COLOR
                    break
    return pixels


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def _write_png(path: Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0]) if height else 0
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # no filter
        for r, g, b, a in row:
            raw.extend((r, g, b, a))
    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    png.extend(_chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
    png.extend(_chunk(b"IEND", b""))
    path.write_bytes(png)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Generate Beatmaker pad icons")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Output directory for generated icons (defaults to the icons/ directory)",
    )
    args = parser.parse_args()

    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    for size in OUTPUT_SIZES:
        pixels = _generate_pixels(size)
        target = out_dir / f"pad-{size}.png"
        _write_png(target, pixels)
        try:
            rel = target.relative_to(Path.cwd())
        except ValueError:
            rel = target
        print(f"wrote {rel} ({size}x{size})")


if __name__ == "__main__":
    main()
