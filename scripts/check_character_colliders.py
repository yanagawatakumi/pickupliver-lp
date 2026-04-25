#!/usr/bin/env python3
"""Validate Animal Tower character collider JSONs against strict QA gate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image, ImageDraw

DEFAULT_MIN_EDGE_WORLD = 1.0
DEFAULT_MAX_REFLEX_RATIO = 0.55
DEFAULT_MAX_VERTICES = 96
DEFAULT_MAX_CONSECUTIVE_SHARP = 6
DEFAULT_MIN_IOU = 0.87
DEFAULT_MAX_UNCOVERED = 0.07
DEFAULT_ALPHA_THRESHOLD = 8


def count_nonzero(mask: Image.Image) -> int:
    return sum(1 for value in mask.getdata() if value)


def validate_alignment(
    png_path: Path,
    collider_payload: Dict,
    alpha_threshold: int,
    min_iou: float,
    max_uncovered_ratio: float,
) -> Tuple[List[str], Dict[str, float]]:
    image = Image.open(png_path).convert("RGBA")
    alpha = image.split()[-1]
    alpha_mask = alpha.point(lambda a: 255 if a > alpha_threshold else 0)

    source_width = int(round(float(collider_payload["sourceWidth"])))
    source_height = int(round(float(collider_payload["sourceHeight"])))
    errors: List[str] = []
    if (source_width, source_height) != image.size:
        errors.append(f"dimension mismatch: png={image.size}, collider=({source_width}, {source_height})")
        return errors, {"iou": 0.0, "uncoveredRatio": 1.0}

    vertices = collider_payload.get("vertices") or []
    points = [(float(v["x"]), float(v["y"])) for v in vertices]
    collider_mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(collider_mask).polygon(points, fill=255)

    alpha_count = count_nonzero(alpha_mask)
    collider_count = count_nonzero(collider_mask)
    if alpha_count == 0:
        errors.append("PNG alpha mask is empty")
        return errors, {"iou": 0.0, "uncoveredRatio": 1.0}
    if collider_count == 0:
        errors.append("Collider mask is empty")
        return errors, {"iou": 0.0, "uncoveredRatio": 1.0}

    inter_count = sum(
        1
        for a, b in zip(alpha_mask.getdata(), collider_mask.getdata())
        if a and b
    )
    union_count = alpha_count + collider_count - inter_count
    iou = inter_count / union_count if union_count else 0.0
    uncovered_ratio = (alpha_count - inter_count) / alpha_count

    if iou < min_iou:
        errors.append(f"iou {iou:.6f} < {min_iou}")
    if uncovered_ratio > max_uncovered_ratio:
        errors.append(f"uncoveredRatio {uncovered_ratio:.6f} > {max_uncovered_ratio}")

    return errors, {"iou": iou, "uncoveredRatio": uncovered_ratio}


def validate_geometry(qa: Dict, min_edge_world: float, max_reflex_ratio: float, max_vertices: int, max_consecutive_sharp: int) -> List[str]:
    errors: List[str] = []
    if not isinstance(qa, dict):
        return ["qa metadata is missing"]

    vertex_count = qa.get("vertexCount")
    min_edge = qa.get("minEdgeWorld")
    reflex_ratio = qa.get("reflexRatio")
    self_intersection = qa.get("selfIntersection")
    max_sharp = qa.get("maxConsecutiveSharp")

    if not isinstance(vertex_count, int):
        errors.append("qa.vertexCount is missing or invalid")
    if not isinstance(min_edge, (int, float)):
        errors.append("qa.minEdgeWorld is missing or invalid")
    if not isinstance(reflex_ratio, (int, float)):
        errors.append("qa.reflexRatio is missing or invalid")
    if not isinstance(self_intersection, int):
        errors.append("qa.selfIntersection is missing or invalid")
    if not isinstance(max_sharp, int):
        errors.append("qa.maxConsecutiveSharp is missing or invalid")

    if errors:
        return errors

    if self_intersection != 0:
        errors.append(f"selfIntersection={self_intersection}")
    if vertex_count > max_vertices:
        errors.append(f"vertexCount={vertex_count} > {max_vertices}")
    if min_edge < min_edge_world:
        errors.append(f"minEdgeWorld={min_edge:.4f} < {min_edge_world}")
    if reflex_ratio > max_reflex_ratio:
        errors.append(f"reflexRatio={reflex_ratio:.6f} > {max_reflex_ratio}")
    if max_sharp > max_consecutive_sharp:
        errors.append(f"maxConsecutiveSharp={max_sharp} > {max_consecutive_sharp}")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate character colliders from config")
    parser.add_argument("--config", type=Path, default=Path("content/games/l-singer-tower-battle/config.json"))
    parser.add_argument("--min-edge-world", type=float, default=DEFAULT_MIN_EDGE_WORLD)
    parser.add_argument("--max-reflex-ratio", type=float, default=DEFAULT_MAX_REFLEX_RATIO)
    parser.add_argument("--max-vertices", type=int, default=DEFAULT_MAX_VERTICES)
    parser.add_argument("--max-consecutive-sharp", type=int, default=DEFAULT_MAX_CONSECUTIVE_SHARP)
    parser.add_argument("--min-iou", type=float, default=DEFAULT_MIN_IOU)
    parser.add_argument("--max-uncovered-ratio", type=float, default=DEFAULT_MAX_UNCOVERED)
    parser.add_argument("--alpha-threshold", type=int, default=DEFAULT_ALPHA_THRESHOLD)
    args = parser.parse_args()

    payload = json.loads(args.config.read_text(encoding="utf-8"))
    shapes = payload.get("shapes") or []
    character_shapes = [shape for shape in shapes if shape.get("kind") == "character"]

    if not character_shapes:
        raise ValueError("character shapes are not configured")

    has_failures = False
    for shape in character_shapes:
        shape_id = str(shape.get("id") or "")
        image_path = Path(str(shape.get("imagePath") or "").lstrip("/"))
        collider_path = Path(str(shape.get("colliderPath") or "").lstrip("/"))

        failures: List[str] = []
        metrics = {"iou": 0.0, "uncoveredRatio": 1.0}

        if not shape_id:
            failures.append("shape.id is missing")
        if not image_path.exists():
            failures.append(f"image missing: {image_path}")
        if not collider_path.exists():
            failures.append(f"collider missing: {collider_path}")

        collider_payload = None
        if not failures:
            collider_payload = json.loads(collider_path.read_text(encoding="utf-8"))
            failures.extend(
                validate_geometry(
                    collider_payload.get("qa"),
                    args.min_edge_world,
                    args.max_reflex_ratio,
                    args.max_vertices,
                    args.max_consecutive_sharp,
                )
            )
            align_errors, metrics = validate_alignment(
                image_path,
                collider_payload,
                args.alpha_threshold,
                args.min_iou,
                args.max_uncovered_ratio,
            )
            failures.extend(align_errors)

        if failures:
            has_failures = True
            print(f"[FAIL] {shape_id}")
            for item in failures:
                print(f"  - {item}")
        else:
            print(
                f"[PASS] {shape_id} iou={metrics['iou']:.6f} "
                f"uncoveredRatio={metrics['uncoveredRatio']:.6f}"
            )

    if has_failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
