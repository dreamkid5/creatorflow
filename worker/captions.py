#!/usr/bin/env python3
"""
Build modern storytime ASS captions from word timings.

Words appear in short uppercase phrases with a black outline. The currently
spoken word sits on a solid rounded highlight box.
"""
import sys
import json

try:
    from PIL import ImageFont
except ImportError:
    sys.exit("Pillow not installed. Run: pip install pillow")


def ass_time(seconds):
    seconds = max(0, seconds)
    hours = int(seconds // 3600)
    seconds -= hours * 3600
    minutes = int(seconds // 60)
    seconds -= minutes * 60
    whole = int(seconds)
    centis = int(round((seconds - whole) * 100))
    if centis == 100:
        centis = 0
        whole += 1
    return f"{hours}:{minutes:02d}:{whole:02d}.{centis:02d}"


def hex_to_ass(value):
    color = value.lstrip("#")
    red, green, blue = (
        int(color[0:2], 16),
        int(color[2:4], 16),
        int(color[4:6], 16),
    )
    return f"&H00{blue:02X}{green:02X}{red:02X}"


def rounded_rect(cx, cy, half_width, half_height, radius):
    x0, y0 = round(cx - half_width), round(cy - half_height)
    x1, y1 = round(cx + half_width), round(cy + half_height)
    radius = round(min(radius, half_width, half_height))
    return (
        f"m {x0+radius} {y0} l {x1-radius} {y0} "
        f"b {x1} {y0} {x1} {y0} {x1} {y0+radius} "
        f"l {x1} {y1-radius} b {x1} {y1} {x1} {y1} {x1-radius} {y1} "
        f"l {x0+radius} {y1} b {x0} {y1} {x0} {y1} {x0} {y1-radius} "
        f"l {x0} {y0+radius} b {x0} {y0} {x0} {y0} {x0+radius} {y0}"
    )


def header(width, height, family, size):
    outline = max(3, round(size * 0.10))
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\n"
        "WrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding\n"
        f"Style: Cap,{family},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,"
        f"-1,0,0,0,100,100,0,0,1,{outline},0,5,40,40,40,1\n"
        f"Style: Box,{family},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,"
        "-1,0,0,0,100,100,0,0,1,0,0,5,40,40,40,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, "
        "Effect, Text\n"
    )


def main():
    words_json, out_ass = sys.argv[1], sys.argv[2]
    width, height = int(sys.argv[3]), int(sys.argv[4])
    font_path, font_family = sys.argv[5], sys.argv[6]
    font_size = int(sys.argv[7])
    highlight = hex_to_ass(sys.argv[8])
    max_words = int(sys.argv[9]) if len(sys.argv) > 9 else 4
    y_fraction = float(sys.argv[10]) if len(sys.argv) > 10 else 0.72

    words = json.load(open(words_json, encoding="utf-8"))
    words = [word for word in words if str(word.get("w", "")).strip()]
    if not words:
        open(out_ass, "w", encoding="utf-8").write(
            header(width, height, font_family, font_size)
        )
        return

    for index, word in enumerate(words):
        word["display"] = (
            str(word["w"])
            .upper()
            .replace("\\", "/")
            .replace("{", "(")
            .replace("}", ")")
        )
        word["end"] = (
            words[index + 1]["t"]
            if index + 1 < len(words)
            else word["t"] + max(0.2, word["d"])
        )

    font = ImageFont.truetype(font_path, font_size)
    try:
        font.set_variation_by_axes([800])
    except (AttributeError, OSError):
        pass
    space_width = font.getlength(" ")
    line_height = int(font_size * 1.15)
    y = int(height * y_fraction)
    center_x = width / 2.0

    phrases, current = [], []
    for word in words:
        current.append(word)
        if len(current) >= max_words or str(word["w"]).rstrip()[-1:] in ".!?":
            phrases.append(current)
            current = []
    if current:
        phrases.append(current)

    box_events, text_events = [], []
    for phrase in phrases:
        texts = [word["display"] for word in phrase]
        widths = [font.getlength(text) for text in texts]
        total_width = sum(widths) + space_width * (len(phrase) - 1)
        cursor = -total_width / 2.0
        centers = []
        for word_width in widths:
            centers.append(cursor + word_width / 2.0)
            cursor += word_width + space_width

        phrase_start, phrase_end = phrase[0]["t"], phrase[-1]["end"]
        for text, word_width, offset, word in zip(
            texts, widths, centers, phrase
        ):
            word_x = center_x + offset
            text_events.append(
                f"Dialogue: 1,{ass_time(phrase_start)},{ass_time(phrase_end)},"
                f"Cap,,0,0,0,,{{\\an5\\pos({word_x:.0f},{y})}}{text}"
            )
            drawing = rounded_rect(
                word_x,
                y,
                word_width / 2.0 + font_size * 0.28,
                line_height / 2.0 + font_size * 0.10,
                font_size * 0.22,
            )
            box_events.append(
                f"Dialogue: 0,{ass_time(word['t'])},{ass_time(word['end'])},"
                f"Box,,0,0,0,,{{\\an7\\pos(0,0)\\p1\\1c{highlight}"
                f"\\bord0\\shad0}}{drawing}{{\\p0}}"
            )

    with open(out_ass, "w", encoding="utf-8") as output:
        output.write(header(width, height, font_family, font_size))
        for event in box_events:
            output.write(event + "\n")
        for event in text_events:
            output.write(event + "\n")


main()
