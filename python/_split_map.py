import ast
from pathlib import Path

src = Path("processor.py").read_text(encoding="utf-8")
tree = ast.parse(src)
for node in tree.body:
    if isinstance(node, ast.Assign):
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        print(f"ASSIGN {names} L{node.lineno}-{node.end_lineno}")
    elif isinstance(node, (ast.FunctionDef, ast.ClassDef)):
        print(f"{type(node).__name__} {node.name} L{node.lineno}-{node.end_lineno}")
    elif isinstance(node, ast.ImportFrom):
        print(f"FROM {node.module} L{node.lineno}")
