#!/usr/bin/env python3
"""Build the locked storytime thumbnail layout from the video's presenter."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


WIDTH, HEIGHT = 1280, 720
PRESENTER_X = 750
TEXT_X = 44
TEXT_RIGHT = 725
PALETTE = ("#7C3AED", "#0891B2", "#EA580C", "#DB2777")


def word_width(draw, word, font):
    return draw.textlength(word, font=font)


def wrap_words(draw, words, font):
    lines = []
    current = []
    current_width = 0
    space = word_width(draw, " ", font)
    max_width = TEXT_RIGHT - TEXT_X
    for item in words:
        width = word_width(draw, item["text"], font)
        proposed = width if not current else current_width + space + width
        if current and proposed > max_width:
            lines.append(current)
            current = [item]
            current_width = width
        else:
            current.append(item)
            current_width = proposed
    if current:
        lines.append(current)
    return lines


def choose_layout(draw, words, font_path):
    for size in range(82, 41, -2):
        font = ImageFont.truetype(font_path, size)
        try:
            font.set_variation_by_axes([800])
        except (AttributeError, OSError):
            pass
        lines = wrap_words(draw, words, font)
        line_height = round(size * 1.14)
        if len(lines) <= 7 and len(lines) * line_height <= 590:
            return font, lines, line_height, size
    font = ImageFont.truetype(font_path, 40)
    try:
        font.set_variation_by_axes([800])
    except (AttributeError, OSError):
        pass
    return font, wrap_words(draw, words, font), 46, 40


def add_presenter(canvas, presenter_path):
    presenter = Image.open(presenter_path).convert("RGB")
    portrait = ImageOps.fit(
        presenter,
        (WIDTH - PRESENTER_X, HEIGHT),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.43),
    )
    canvas.paste(portrait, (PRESENTER_X, 0))

    # The reference has a soft white transition between its copy and portrait.
    fade_width = 85
    fade = Image.new("RGBA", (fade_width, HEIGHT), (255, 255, 255, 0))
    alpha = Image.new("L", (fade_width, HEIGHT))
    for x in range(fade_width):
        value = round(255 * (1 - x / max(1, fade_width - 1)))
        for y in range(HEIGHT):
            alpha.putpixel((x, y), value)
    fade.putalpha(alpha)
    canvas.paste(fade, (PRESENTER_X, 0), fade)


def main():
    presenter_path, output_path, hook_text, font_path = sys.argv[1:5]
    words_raw = hook_text.replace("\n", " ").split()
    if not words_raw:
        raise SystemExit("thumbnail hook is empty")
    if not Path(presenter_path).exists():
        raise SystemExit("presenter image is missing")

    count = len(words_raw)
    words = []
    for index, text in enumerate(words_raw):
        band = min(len(PALETTE) - 1, index * len(PALETTE) // count)
        words.append({"text": text, "color": PALETTE[band]})

    canvas = Image.new("RGB", (WIDTH, HEIGHT), "white")
    add_presenter(canvas, presenter_path)
    draw = ImageDraw.Draw(canvas)
    font, lines, line_height, font_size = choose_layout(draw, words, font_path)
    total_height = len(lines) * line_height
    y = max(52, round((HEIGHT - total_height) / 2))
    stroke = max(3, round(font_size * 0.055))
    space = word_width(draw, " ", font)

    for line in lines:
        x = TEXT_X
        for item in line:
            draw.text(
                (x, y),
                item["text"],
                font=font,
                fill=item["color"],
                stroke_width=stroke,
                stroke_fill="#101014",
            )
            x += word_width(draw, item["text"], font) + space
        y += line_height

    canvas.save(output_path, "JPEG", quality=94, subsampling=0)


if __name__ == "__main__":
    main()
