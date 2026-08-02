#!/usr/bin/env python3
"""Build the locked two-beat storytime thumbnail from the video's presenter."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


WIDTH, HEIGHT = 1280, 720
PRESENTER_X = 750
TEXT_X = 44
TEXT_RIGHT = 725
PALETTE = ("#7C3AED", "#0891B2", "#EA580C", "#DB2777")
BEAT_GAP = 26


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


def wrap_beats(draw, beats, font):
    return [wrap_words(draw, beat, font) for beat in beats]


def choose_layout(draw, beats, font_path):
    for size in range(96, 53, -2):
        font = ImageFont.truetype(font_path, size)
        try:
            font.set_variation_by_axes([800])
        except (AttributeError, OSError):
            pass
        wrapped = wrap_beats(draw, beats, font)
        lines = [line for beat in wrapped for line in beat]
        line_height = round(size * 1.14)
        total_height = len(lines) * line_height + BEAT_GAP
        if all(len(beat) <= 2 for beat in wrapped) and len(lines) <= 4 and total_height <= 590:
            return font, wrapped, line_height, size
    font = ImageFont.truetype(font_path, 52)
    try:
        font.set_variation_by_axes([800])
    except (AttributeError, OSError):
        pass
    return font, wrap_beats(draw, beats, font), 59, 52


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
    beat_texts = [line.strip() for line in hook_text.splitlines() if line.strip()]
    if len(beat_texts) != 2:
        raise SystemExit("thumbnail hook must contain exactly two headline lines")
    if not Path(presenter_path).exists():
        raise SystemExit("presenter image is missing")

    beats = []
    for beat_index, beat_text in enumerate(beat_texts):
        words_raw = beat_text.split()
        colors = PALETTE[beat_index * 2 : beat_index * 2 + 2]
        words = []
        for index, text in enumerate(words_raw):
            band = min(len(colors) - 1, index * len(colors) // len(words_raw))
            words.append({"text": text, "color": colors[band]})
        beats.append(words)

    canvas = Image.new("RGB", (WIDTH, HEIGHT), "white")
    add_presenter(canvas, presenter_path)
    draw = ImageDraw.Draw(canvas)
    font, wrapped_beats, line_height, font_size = choose_layout(draw, beats, font_path)
    total_lines = sum(len(beat) for beat in wrapped_beats)
    total_height = total_lines * line_height + BEAT_GAP
    y = max(52, round((HEIGHT - total_height) / 2))
    stroke = max(3, round(font_size * 0.055))
    space = word_width(draw, " ", font)

    for beat_index, lines in enumerate(wrapped_beats):
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
        if beat_index == 0:
            y += BEAT_GAP

    canvas.save(output_path, "JPEG", quality=94, subsampling=0)


if __name__ == "__main__":
    main()
