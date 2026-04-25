#!/usr/bin/env python3
"""Validate PNG alpha and collider JSON alignment for L Singer Tower Battle."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


def count_nonzero(mask: Image.Image) -> int:
    return sum(1 for value in mask.getdata() if value)


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate collider-vs-png alignment")
    parser.add_argument("png", type=Path)
    parser.add_argument("collider", type=Path)
    parser.add_argument("--alpha-threshold", type=int, default=8)
    parser.add_argument("--min-iou", type=float, default=0.96)
    parser.add_argument("--max-uncovered-ratio", type=float, default=0.025)
    args = parser.parse_args()

    image = Image.open(args.png).convert("RGBA")
    alpha = image.split()[-1]
    alpha_mask = alpha.point(lambda a: 255 if a > args.alpha_threshold else 0)

    payload = json.loads(args.collider.read_text(encoding="utf-8"))
    source_width = int(round(float(payload["sourceWidth"])))
    source_height = int(round(float(payload["sourceHeight"])))
    if (source_width, source_height) != image.size:
        raise ValueError(
            f"dimension mismatch: png={image.size}, collider=({source_width}, {source_height})"
        )

    points = [(float(v["x"]), float(v["y"])) for v in payload["vertices"]]
    collider_mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(collider_mask).polygon(points, fill=255)

    alpha_count = count_nonzero(alpha_mask)
    collider_count = count_nonzero(collider_mask)
    if alpha_count == 0:
        raise ValueError("PNG alpha mask is empty")
    if collider_count == 0:
        raise ValueError("Collider mask is empty")

    inter_data = [
        255 if (a and b) else 0
        for a, b in zip(alpha_mask.getdata(), collider_mask.getdata())
    ]
    inter_count = sum(1 for v in inter_data if v)
    union_count = alpha_count + collider_count - inter_count
    iou = inter_count / union_count if union_count else 0.0
    uncovered_ratio = (alpha_count - inter_count) / alpha_count

    print(
        f"iou={iou:.6f} uncoveredRatio={uncovered_ratio:.6f} "
        f"alphaPx={alpha_count} colliderPx={collider_count}"
    )

    errors: list[str] = []
    if iou < args.min_iou:
        errors.append(f"iou {iou:.6f} < {args.min_iou}")
    if uncovered_ratio > args.max_uncovered_ratio:
        errors.append(
            f"uncoveredRatio {uncovered_ratio:.6f} > {args.max_uncovered_ratio}"
        )
    if errors:
        raise ValueError("alignment QA failed: " + "; ".join(errors))


if __name__ == "__main__":
    main()
