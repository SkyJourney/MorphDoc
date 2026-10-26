"""从固定的 Noto CJK 可变字体生成墨呈静态字体面。"""

from __future__ import annotations

import argparse
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


def set_name(font: TTFont, name_id: int, value: str) -> None:
    name_table = font["name"]
    for platform_id, encoding_id, language_id in (
        (3, 1, 0x0409),
        (1, 0, 0),
    ):
        name_table.setName(
            value,
            name_id,
            platform_id,
            encoding_id,
            language_id,
        )


def build_face(
    source: Path,
    output_root: Path,
    family: str,
    postscript_family: str,
    weight: int,
    style: str,
) -> None:
    font = TTFont(source, recalcTimestamp=False)
    instantiateVariableFont(font, {"wght": weight}, inplace=True, optimize=True)

    set_name(font, 1, family)
    set_name(font, 2, style)
    set_name(font, 4, f"{family} {style}")
    set_name(font, 6, f"{postscript_family}-{style}")
    set_name(font, 16, family)
    set_name(font, 17, style)
    set_name(font, 25, postscript_family)
    font["OS/2"].usWeightClass = weight
    font["OS/2"].fsType = 0

    output_root.mkdir(parents=True, exist_ok=True)
    ttf_path = output_root / f"{postscript_family}-{style}.ttf"
    font.flavor = None
    font.save(ttf_path, reorderTables=False)

    woff2_path = output_root / f"{postscript_family}-{style}.woff2"
    font.flavor = "woff2"
    font.save(woff2_path, reorderTables=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--family", required=True)
    parser.add_argument("--postscript-family", required=True)
    arguments = parser.parse_args()

    build_face(
        arguments.source,
        arguments.output,
        arguments.family,
        arguments.postscript_family,
        400,
        "Regular",
    )
    build_face(
        arguments.source,
        arguments.output,
        arguments.family,
        arguments.postscript_family,
        700,
        "Bold",
    )


if __name__ == "__main__":
    main()
