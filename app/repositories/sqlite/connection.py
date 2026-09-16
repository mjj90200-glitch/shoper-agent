"""SQLite 短连接辅助：每次操作新建连接，避免跨事件循环持有连接。"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def open_connection(database_path: Path) -> Iterator[sqlite3.Connection]:
    """打开带 Row 工厂的连接；with 块结束时提交/回滚并关闭连接。"""

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()
