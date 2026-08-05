"""test_support.py — завантаження скриптів агентів у тести.

Скрипти названі через дефіс (deep-research.py), тому звичайний import для них
недоступний: `import deep-research` — синтаксична помилка. Тут єдине місце, яке
знає, як їх підвантажити, щоб кожен тестовий файл не винаходив свій спосіб.

Завантаження виконує модуль цілком, тож воно безпечне лише для скриптів із
`if __name__ == "__main__"` — інакше імпорт запустив би сам скрипт.
"""

from __future__ import annotations

import importlib.util
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

_cache: dict[str, object] = {}


def load_script(filename: str):
    if filename in _cache:
        return _cache[filename]
    path = os.path.join(SCRIPT_DIR, filename)
    module_name = "_script_" + os.path.basename(filename).removesuffix(".py").replace("-", "_")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"не вдалось підготувати завантаження {path}")
    module = importlib.util.module_from_spec(spec)
    # Реєстрація до exec_module: модуль може імпортувати сам себе опосередковано.
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    _cache[filename] = module
    return module
