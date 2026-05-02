import json
import sys
from pathlib import Path

from app.main import app


content = json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"

if len(sys.argv) > 1:
    output_path = Path(sys.argv[1])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
else:
    print(content, end="")
