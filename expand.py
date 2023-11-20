"""
$: python3 expand.py

This script expands assets/chess_pieces.obj into
individual chess piece objs in assets/chess/
"""

import os
from pathlib import Path

assets = Path(__file__).parent / "assets"
chess = assets / "chess"
chess.mkdir(exist_ok=True)
chess_obj = (assets / "chess_pieces.obj").read_text()

name = None
current = []
for line in chess_obj.split("\n"):
    if "#" in line and "object" not in line:
        continue
    if "object" in line or "END" in line:
        if name is not None:
            (chess / f"{name}.obj").write_text("\n".join(current))
        current = []
        name = line.strip().split(" ")[2]
    if "END" in line:
        break
    current.append(line)
