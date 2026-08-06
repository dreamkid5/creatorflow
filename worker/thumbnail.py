#!/usr/bin/env python3
"""Build the locked wordy four-beat storytime thumbnail from the video's presenter.

The left panel is a bold, sentence-case paragraph split into four colour-coded
beats (green setup, black pivot, gold leverage, red payoff) that read
continuously. The video's exact presenter fills the right panel. The type
auto-fits so a long, provocative hook always fills the panel without overflowing.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


WIDTH, HEIGHT = 1280, 720
PRESENTER_X = 758           # presenter fills the right ~40%
TEXT_X = 40
TEXT_RIGHT = 726            # copy stays clear of the presenter fade
TOP_MARGIN = 34
BOTTOM_MARGIN = 34

# Beat colours, matched to the reference thumbnail.
BEAT_COLORS = {
    "setup": "#1FA24A",     # green  - the betrayal / overreach
    "pivot": "#141414",     # black  - the turn
    "leverage": "#D69A1E",  # gold   - the hidden advantage
    "payoff": "#E22318",     # red    - the payoff
}
BEAT_ORDER = ("setup", "pivot", "leverage", "payoff")


def load_font(font_path, size):
    font = ImageFont.truetype(font_path, size)
    try:
        font.set_variation_by_axes([800])
    except (AttributeError, OSError):
        pass
    return font


def word_width(draw, word, font):
    return draw.textlength(word, font=font)


def wrap_tokens(draw, tokens, font):
    """Greedy word wrap that keeps each token's colour. Returns list of lines,
    where a line is a list of {text, color} tokens."""
    lines = []
    current = []
    current_width = 0
    space = word_width(draw, " ", font)
    max_width = TEXT_RIGHT - TEXT_X
    for token in tokens:
        width = word_width(draw, token["text"], font)
        proposed = width if not current else current_width + space + width
        if current and proposed > max_width:
            lines.append(current)
            current = [token]
            current_width = width
        else:
            current.append(token)
            current_width = proposed
    if current:
        lines.append(current)
    return lines


def layout(draw, tokens, font_path):
    """Pick the largest font size at which the whole hook fits the left panel."""
    available = HEIGHT - TOP_MARGIN - BOTTOM_MARGIN
    for size in range(74, 33, -2):
        font = load_font(font_path, size)
        line_height = round(size * 1.12)
        lines = wrap_tokens(draw, tokens, font)
        wide = any(
            sum(word_width(draw, t["text"], font) for t in line)
            + word_width(draw, " ", font) * (len(line) - 1) > TEXT_RIGHT - TEXT_X
            for line in lines
        )
        if not wide and len(lines) * line_height <= available:
            return font, lines, line_height, size
    font = load_font(font_path, 34)
    return font, wrap_tokens(draw, tokens, font), round(34 * 1.12), 34


def add_presenter(canvas, presenter_path):
    presenter = Image.open(presenter_path).convert("RGB")
    portrait = ImageOps.fit(
        presenter,
        (WIDTH - PRESENTER_X, HEIGHT),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.42),
    )
    canvas.paste(portrait, (PRESENTER_X, 0))

    # Soft white transition between the copy and the portrait.
    fade_width = 90
    fade = Image.new("RGBA", (fade_width, HEIGHT), (255, 255, 255, 0))
    alpha = Image.new("L", (fade_width, HEIGHT))
    for x in range(fade_width):
        value = round(255 * (1 - x / max(1, fade_width - 1)))
        for y in range(HEIGHT):
            alpha.putpixel((x, y), value)
    fade.putalpha(alpha)
    canvas.paste(fade, (PRESENTER_X, 0), fade)


def main():
    presenter_path, output_path, font_path = sys.argv[1:4]
    beats = sys.argv[4:8]
    if len(beats) != 4:
        raise SystemExit("thumbnail needs four beats: setup pivot leverage payoff")
    if not Path(presenter_path).exists():
        raise SystemExit("presenter image is missing")

    # Flatten the four beats into one coloured token stream.
    tokens = []
    for key, text in zip(BEAT_ORDER, beats):
        color = BEAT_COLORS[key]
        for word in str(text).split():
            tokens.append({"text": word, "color": color})
    if not tokens:
        raise SystemExit("thumbnail hook is empty")

    canvas = Image.new("RGB", (WIDTH, HEIGHT), "white")
    add_presenter(canvas, presenter_path)
    draw = ImageDraw.Draw(canvas)

    font, lines, line_height, font_size = layout(draw, tokens, font_path)
    total_height = len(lines) * line_height
    y = max(TOP_MARGIN, round((HEIGHT - total_height) / 2))
    # A hair of dark outline keeps the light gold readable against white.
    stroke = max(0, round(font_size * 0.02))
    space = word_width(draw, " ", font)

    for line in lines:
        x = TEXT_X
        for token in line:
            draw.text(
                (x, y),
                token["text"],
                font=font,
                fill=token["color"],
                stroke_width=stroke,
                stroke_fill=token["color"],
            )
            x += word_width(draw, token["text"], font) + space
        y += line_height

    canvas.save(output_path, "JPEG", quality=94, subsampling=0)


if __name__ == "__main__":
    main()
