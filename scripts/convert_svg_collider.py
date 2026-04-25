#!/usr/bin/env python3
"""Convert single-path SVG outlines into collider vertex JSON for L Singer Tower Battle.

Expected input: one character SVG with a single closed outer path.
Output JSON shape:
{
  "sourceWidth": <number>,
  "sourceHeight": <number>,
  "vertices": [{"x":..,"y":..}, ...]
}
"""

from __future__ import annotations

import argparse
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

Point = Tuple[float, float]
CMD_RE = re.compile(r"[MmLlHhVvCcSsQqZz]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def cubic_bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: float) -> Point:
    u = 1.0 - t
    x = (u ** 3) * p0[0] + 3 * (u ** 2) * t * p1[0] + 3 * u * (t ** 2) * p2[0] + (t ** 3) * p3[0]
    y = (u ** 3) * p0[1] + 3 * (u ** 2) * t * p1[1] + 3 * u * (t ** 2) * p2[1] + (t ** 3) * p3[1]
    return (x, y)


def quad_bezier(p0: Point, p1: Point, p2: Point, t: float) -> Point:
    u = 1.0 - t
    x = (u ** 2) * p0[0] + 2 * u * t * p1[0] + (t ** 2) * p2[0]
    y = (u ** 2) * p0[1] + 2 * u * t * p1[1] + (t ** 2) * p2[1]
    return (x, y)


def distance_to_segment(p: Point, a: Point, b: Point) -> float:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    if dx == 0 and dy == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    proj = (a[0] + t * dx, a[1] + t * dy)
    return math.hypot(p[0] - proj[0], p[1] - proj[1])


def rdp(points: Sequence[Point], epsilon: float) -> List[Point]:
    if len(points) <= 2:
        return list(points)

    first, last = points[0], points[-1]
    max_dist = -1.0
    idx = 0
    for i in range(1, len(points) - 1):
        dist = distance_to_segment(points[i], first, last)
        if dist > max_dist:
            max_dist = dist
            idx = i

    if max_dist <= epsilon:
        return [first, last]

    left = rdp(points[: idx + 1], epsilon)
    right = rdp(points[idx:], epsilon)
    return left[:-1] + right


def simplify_closed(points: Sequence[Point], epsilon: float) -> List[Point]:
    if len(points) < 4:
        return list(points)
    closed = list(points)
    if closed[0] != closed[-1]:
        closed.append(closed[0])
    simplified = rdp(closed, epsilon)
    if simplified and simplified[0] == simplified[-1]:
        simplified = simplified[:-1]
    return simplified


def polygon_area(points: Sequence[Point]) -> float:
    area = 0.0
    if not points:
        return area
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        area += p[0] * q[1] - q[0] * p[1]
    return area * 0.5


def ensure_clockwise(points: List[Point]) -> List[Point]:
    if polygon_area(points) > 0:
        return list(reversed(points))
    return points


def parse_size(root: ET.Element) -> Tuple[float, float]:
    view_box = root.attrib.get("viewBox")
    if view_box:
        nums = [float(n) for n in re.split(r"[\s,]+", view_box.strip()) if n]
        if len(nums) == 4:
            return nums[2], nums[3]

    def parse_dim(value: str | None) -> float | None:
        if not value:
            return None
        m = re.match(r"\s*([-+]?\d*\.?\d+)", value)
        return float(m.group(1)) if m else None

    w = parse_dim(root.attrib.get("width"))
    h = parse_dim(root.attrib.get("height"))
    if w and h:
        return w, h

    raise ValueError("SVG size could not be resolved (need viewBox or width/height)")


def parse_path_points(path_d: str, curve_steps: int) -> List[Point]:
    tokens = CMD_RE.findall(path_d)
    if not tokens:
        raise ValueError("Path has no tokens")

    points: List[Point] = []
    i = 0
    cmd = None
    current = (0.0, 0.0)
    start = (0.0, 0.0)
    prev_cmd = None
    last_cubic_ctrl: Point | None = None
    last_quad_ctrl: Point | None = None

    def read_num() -> float:
        nonlocal i
        if i >= len(tokens):
            raise ValueError("Unexpected end of path data")
        token = tokens[i]
        i += 1
        return float(token)

    while i < len(tokens):
        if re.match(r"^[A-Za-z]$", tokens[i]):
            cmd = tokens[i]
            i += 1
        elif cmd is None:
            raise ValueError("Path data missing initial command")

        assert cmd is not None

        if cmd in ("M", "m"):
            x = read_num()
            y = read_num()
            current = (x, y) if cmd == "M" else (current[0] + x, current[1] + y)
            start = current
            points.append(current)
            prev_cmd = cmd
            last_cubic_ctrl = None
            last_quad_ctrl = None
            cmd = "L" if cmd == "M" else "l"
            continue

        if cmd in ("L", "l"):
            while i < len(tokens) and not re.match(r"^[A-Za-z]$", tokens[i]):
                x = read_num()
                y = read_num()
                current = (x, y) if cmd == "L" else (current[0] + x, current[1] + y)
                points.append(current)
                prev_cmd = cmd
                last_cubic_ctrl = None
                last_quad_ctrl = None
            continue

        if cmd in ("H", "h"):
            while i < len(tokens) and not re.match(r"^[A-Za-z]$", tokens[i]):
                x = read_num()
                current = (x, current[1]) if cmd == "H" else (current[0] + x, current[1])
                points.append(current)
                prev_cmd = cmd
                last_cubic_ctrl = None
                last_quad_ctrl = None
            continue

        if cmd in ("V", "v"):
            while i < len(tokens) and not re.match(r"^[A-Za-z]$", tokens[i]):
                y = read_num()
                current = (current[0], y) if cmd == "V" else (current[0], current[1] + y)
                points.append(current)
                prev_cmd = cmd
                last_cubic_ctrl = None
                last_quad_ctrl = None
            continue

        if cmd in ("C", "c"):
            while i < len(tokens) and not re.match(r"^[A-Za-z]$", tokens[i]):
                x1, y1, x2, y2, x3, y3 = (read_num(), read_num(), read_num(), read_num(), read_num(), read_num())
                p1 = (x1, y1) if cmd == "C" else (current[0] + x1, current[1] + y1)
                p2 = (x2, y2) if cmd == "C" else (current[0] + x2, current[1] + y2)
                p3 = (x3, y3) if cmd == "C" else (current[0] + x3, current[1] + y3)
                for step in range(1, curve_steps + 1):
                    t = step / curve_steps
                    points.append(cubic_bezier(current, p1, p2, p3, t))
                current = p3
                prev_cmd = cmd
                last_cubic_ctrl = p2
                last_quad_ctrl = None
            continue

        if cmd in ("S", "s"):
            while i < len(tokens) and not re.match(r"^[A-Za-z]$", tokens[i]):
                x2, y2, x3, y3 = (read_num(), read_num(), read_num(), read_num())
                if prev_cmd in ("C", "c", "S", "s") and last_cubic_ctrl is not None:
                    p1 = (2 * current[0] - last_cubic_ctrl[0], 2 * current[1] - last_cubic_ctrl[1])
                else:
                    p1 = current
                p2 = (x2, y2) if cmd == "S" else (current[0] + x2, current[1] + y2)
                p3 = (x3, y3) if cmd == "S" else (current[0] + x3, current[1] + y3)
                for step in range(1, curve_steps + 1):
                    t = step / curve_steps
                    points.append(cubic_bezier(current, p1, p2, p3, t))
                current = p3
                prev_cmd = cmd
                last_cubic_ctrl = p2
                last_quad_ctrl = None
            continue

        if cmd in ("Q", "q"):
            while i < len(tokens) and not re.match(r"^[A-Za-z]$", tokens[i]):
                x1, y1, x2, y2 = (read_num(), read_num(), read_num(), read_num())
                p1 = (x1, y1) if cmd == "Q" else (current[0] + x1, current[1] + y1)
                p2 = (x2, y2) if cmd == "Q" else (current[0] + x2, current[1] + y2)
                for step in range(1, curve_steps + 1):
                    t = step / curve_steps
                    points.append(quad_bezier(current, p1, p2, t))
                current = p2
                prev_cmd = cmd
                last_quad_ctrl = p1
                last_cubic_ctrl = None
            continue

        if cmd in ("Z", "z"):
            if current != start:
                points.append(start)
            current = start
            prev_cmd = cmd
            last_cubic_ctrl = None
            last_quad_ctrl = None
            continue

        raise ValueError(f"Unsupported path command: {cmd}")

    if len(points) >= 2 and points[0] == points[-1]:
        points = points[:-1]

    return points


def densify_closed_polyline(points: Sequence[Point], max_step: float) -> List[Point]:
    if len(points) < 2:
        return list(points)
    dense: List[Point] = []
    total = len(points)
    for i, p0 in enumerate(points):
        p1 = points[(i + 1) % total]
        dense.append(p0)
        seg = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        parts = max(1, int(math.ceil(seg / max_step)))
        if parts <= 1:
            continue
        for s in range(1, parts):
            t = s / parts
            dense.append((lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)))
    return dense


def expand_vertices_to_min(points: Sequence[Point], min_vertices: int) -> List[Point]:
    expanded = list(points)
    if len(expanded) < 3:
        return expanded
    while len(expanded) < min_vertices:
        best_idx = 0
        best_len = -1.0
        for i, p0 in enumerate(expanded):
            p1 = expanded[(i + 1) % len(expanded)]
            seg_len = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            if seg_len > best_len:
                best_len = seg_len
                best_idx = i
        p0 = expanded[best_idx]
        p1 = expanded[(best_idx + 1) % len(expanded)]
        mid = ((p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5)
        expanded.insert(best_idx + 1, mid)
    return expanded


def extract_single_path(svg_path: Path) -> Tuple[float, float, str]:
    tree = ET.parse(svg_path)
    root = tree.getroot()
    source_w, source_h = parse_size(root)

    paths = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "path" and el.attrib.get("d"):
            paths.append(el.attrib["d"])

    if len(paths) != 1:
        raise ValueError(f"Expected exactly 1 <path>, found {len(paths)} in {svg_path}")

    return source_w, source_h, paths[0]


def normalize_point_precision(points: Iterable[Point], digits: int) -> List[Point]:
    return [(round(p[0], digits), round(p[1], digits)) for p in points]


def polygon_bbox(points: Sequence[Point]) -> dict:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return {"minX": min(xs), "minY": min(ys), "maxX": max(xs), "maxY": max(ys)}


def polygon_min_edge(points: Sequence[Point]) -> float:
    if len(points) < 2:
        return 0.0
    min_edge = float("inf")
    for i, p0 in enumerate(points):
        p1 = points[(i + 1) % len(points)]
        edge = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if edge < min_edge:
            min_edge = edge
    return min_edge if math.isfinite(min_edge) else 0.0


def count_reflex_vertices(points: Sequence[Point]) -> int:
    if len(points) < 3:
        return 0
    reflex = 0
    total = len(points)
    for i, b in enumerate(points):
        a = points[(i - 1) % total]
        c = points[(i + 1) % total]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        # Polygon is normalized clockwise, so positive cross indicates reflex.
        if cross > 0:
            reflex += 1
    return reflex


def interior_angles(points: Sequence[Point]) -> List[float]:
    if len(points) < 3:
        return []
    angles: List[float] = []
    total = len(points)
    for i, b in enumerate(points):
        a = points[(i - 1) % total]
        c = points[(i + 1) % total]
        v1 = (a[0] - b[0], a[1] - b[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        l1 = math.hypot(v1[0], v1[1])
        l2 = math.hypot(v2[0], v2[1])
        if l1 < 1e-9 or l2 < 1e-9:
            continue
        cosine = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)))
        angles.append(math.degrees(math.acos(cosine)))
    return angles


def max_consecutive_sharp_angles(points: Sequence[Point], sharp_angle_deg: float) -> int:
    angles = interior_angles(points)
    if not angles:
        return 0
    flags = [angle < sharp_angle_deg for angle in angles]
    if not any(flags):
        return 0

    # Circular run length
    doubled = flags + flags
    best = 0
    run = 0
    for flag in doubled:
        if flag:
            run += 1
            best = max(best, run)
        else:
            run = 0
    return min(best, len(flags))


def orientation(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def on_segment(a: Point, b: Point, p: Point) -> bool:
    return (
        min(a[0], b[0]) - 1e-9 <= p[0] <= max(a[0], b[0]) + 1e-9
        and min(a[1], b[1]) - 1e-9 <= p[1] <= max(a[1], b[1]) + 1e-9
    )


def segments_intersect(a1: Point, a2: Point, b1: Point, b2: Point) -> bool:
    o1 = orientation(a1, a2, b1)
    o2 = orientation(a1, a2, b2)
    o3 = orientation(b1, b2, a1)
    o4 = orientation(b1, b2, a2)

    if o1 == 0 and on_segment(a1, a2, b1):
        return True
    if o2 == 0 and on_segment(a1, a2, b2):
        return True
    if o3 == 0 and on_segment(b1, b2, a1):
        return True
    if o4 == 0 and on_segment(b1, b2, a2):
        return True

    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def count_self_intersections(points: Sequence[Point]) -> int:
    if len(points) < 4:
        return 0
    total = len(points)
    count = 0
    for i in range(total):
        a1 = points[i]
        a2 = points[(i + 1) % total]
        for j in range(i + 1, total):
            if abs(i - j) <= 1:
                continue
            if i == 0 and j == total - 1:
                continue
            b1 = points[j]
            b2 = points[(j + 1) % total]
            if segments_intersect(a1, a2, b1, b2):
                count += 1
    return count


def evaluate_qa(points: Sequence[Point], world_scale: float, sharp_angle_deg: float) -> dict:
    min_edge_src = polygon_min_edge(points)
    min_edge_world = min_edge_src * world_scale
    reflex = count_reflex_vertices(points)
    vertex_count = len(points)
    reflex_ratio = reflex / max(1, vertex_count)
    self_intersection = count_self_intersections(points)
    area = abs(polygon_area(points))
    bbox = polygon_bbox(points)
    max_consecutive_sharp = max_consecutive_sharp_angles(points, sharp_angle_deg)
    return {
        "vertexCount": vertex_count,
        "minEdgeWorld": min_edge_world,
        "reflexRatio": reflex_ratio,
        "selfIntersection": self_intersection,
        "bbox": bbox,
        "area": area,
        "maxConsecutiveSharp": max_consecutive_sharp,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert SVG path to collider JSON")
    parser.add_argument("svg", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--min-vertices", type=int, default=20)
    parser.add_argument("--max-vertices", type=int, default=120)
    parser.add_argument("--curve-steps", type=int, default=12)
    parser.add_argument("--max-line-step", type=float, default=14.0)
    parser.add_argument("--epsilon", type=float, default=1.2)
    parser.add_argument("--precision", type=int, default=3)
    parser.add_argument("--world-scale", type=float, default=0.24)
    parser.add_argument("--qa-min-edge-world", type=float, default=1.0)
    parser.add_argument("--qa-max-reflex-ratio", type=float, default=0.55)
    parser.add_argument("--qa-max-vertices", type=int, default=96)
    parser.add_argument("--qa-sharp-angle-deg", type=float, default=55.0)
    parser.add_argument("--qa-max-consecutive-sharp", type=int, default=6)
    args = parser.parse_args()

    source_w, source_h, path_d = extract_single_path(args.svg)
    raw_points = parse_path_points(path_d, curve_steps=max(4, args.curve_steps))
    raw_points = densify_closed_polyline(raw_points, max_step=max(2.0, args.max_line_step))
    if len(raw_points) < 3:
        raise ValueError("Parsed polygon has fewer than 3 points")

    eps = max(0.05, args.epsilon)
    simplified = simplify_closed(raw_points, eps)

    # Keep vertex budget within target range.
    if len(simplified) > args.max_vertices:
        for _ in range(24):
            eps *= 1.25
            simplified = simplify_closed(raw_points, eps)
            if len(simplified) <= args.max_vertices:
                break

    if len(simplified) < args.min_vertices:
        for _ in range(24):
            eps = max(0.05, eps * 0.82)
            simplified = simplify_closed(raw_points, eps)
            if len(simplified) >= args.min_vertices:
                break
        if len(simplified) < args.min_vertices:
            simplified = expand_vertices_to_min(simplified, args.min_vertices)

    simplified = ensure_clockwise(simplified)
    simplified = normalize_point_precision(simplified, args.precision)

    if len(simplified) < 3:
        raise ValueError("Simplified polygon has fewer than 3 points")

    qa = evaluate_qa(
        simplified,
        world_scale=max(0.0001, args.world_scale),
        sharp_angle_deg=max(1.0, args.qa_sharp_angle_deg),
    )
    qa_thresholds = {
        "minEdgeWorld": args.qa_min_edge_world,
        "maxReflexRatio": args.qa_max_reflex_ratio,
        "maxVertices": args.qa_max_vertices,
        "maxConsecutiveSharp": args.qa_max_consecutive_sharp,
        "sharpAngleDeg": args.qa_sharp_angle_deg,
        "selfIntersection": 0,
    }
    qa_errors: List[str] = []
    if qa["selfIntersection"] != 0:
        qa_errors.append(f"selfIntersection={qa['selfIntersection']} (must be 0)")
    if qa["minEdgeWorld"] < args.qa_min_edge_world:
        qa_errors.append(f"minEdgeWorld={qa['minEdgeWorld']:.3f} < {args.qa_min_edge_world}")
    if qa["reflexRatio"] > args.qa_max_reflex_ratio:
        qa_errors.append(f"reflexRatio={qa['reflexRatio']:.4f} > {args.qa_max_reflex_ratio}")
    if qa["vertexCount"] > args.qa_max_vertices:
        qa_errors.append(f"vertexCount={qa['vertexCount']} > {args.qa_max_vertices}")
    if qa["maxConsecutiveSharp"] > args.qa_max_consecutive_sharp:
        qa_errors.append(f"maxConsecutiveSharp={qa['maxConsecutiveSharp']} > {args.qa_max_consecutive_sharp}")

    if qa_errors:
        raise ValueError("Collider QA failed: " + "; ".join(qa_errors))

    output = {
      "sourceWidth": round(source_w, args.precision),
      "sourceHeight": round(source_h, args.precision),
      "vertices": [{"x": p[0], "y": p[1]} for p in simplified],
      "qa": {
        "vertexCount": qa["vertexCount"],
        "minEdgeWorld": round(qa["minEdgeWorld"], 4),
        "reflexRatio": round(qa["reflexRatio"], 6),
        "selfIntersection": int(qa["selfIntersection"]),
        "bbox": {
            "minX": round(qa["bbox"]["minX"], args.precision),
            "minY": round(qa["bbox"]["minY"], args.precision),
            "maxX": round(qa["bbox"]["maxX"], args.precision),
            "maxY": round(qa["bbox"]["maxY"], args.precision),
        },
        "area": round(qa["area"], args.precision),
        "maxConsecutiveSharp": int(qa["maxConsecutiveSharp"]),
        "thresholds": qa_thresholds,
      }
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(simplified)} vertices)")


if __name__ == "__main__":
    main()
