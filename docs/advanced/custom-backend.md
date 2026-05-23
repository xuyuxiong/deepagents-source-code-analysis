# 自定义后端

本文档介绍如何实现自定义后端来扩展 Deep Agents 的存储能力。

## 实现后端协议

后端必须实现 `BackendProtocol` 或 `SandboxBackendProtocol`：

```python
from deepagents.backends.protocol import (
    BackendProtocol,
    SandboxBackendProtocol,
    ReadResult,
    WriteResult,
    EditResult,
    LsResult,
    GrepResult,
    GlobResult,
    FileInfo,
    FileData,
    ExecuteResponse,
)

class MyBackend(BackendProtocol):
    """自定义后端实现"""

    def __init__(self, **kwargs):
        # 初始化存储
        self._storage = {}

    # 文件操作

    def ls(self, path: str) -> LsResult:
        """列出目录"""
        pass

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        """读取文件"""
        pass

    def write(self, file_path: str, content: str) -> WriteResult:
        """写入文件"""
        pass

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:
        """编辑文件"""
        pass

    # 搜索操作

    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult:
        """搜索文本"""
        pass

    def glob(self, pattern: str, path: str = "/") -> GlobResult:
        """匹配文件"""
        pass

    # 批量操作（可选，有默认实现）

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """批量上传"""
        pass

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """批量下载"""
        pass
```

## 内存后端示例

```python
from datetime import datetime
from deepagents.backends.utils import perform_string_replacement

class MemoryBackend(BackendProtocol):
    """内存存储后端"""

    def __init__(self):
        self._files: dict[str, FileData] = {}

    def _create_file_data(self, content: str) -> FileData:
        now = datetime.now().isoformat()
        return FileData(
            content=content,
            encoding="utf-8",
            created_at=now,
            modified_at=now,
        )

    def ls(self, path: str) -> LsResult:
        entries = []
        seen_dirs = set()

        for file_path in self._files:
            if not file_path.startswith(path):
                continue

            # 提取直接子路径
            relative = file_path[len(path):].lstrip("/")
            parts = relative.split("/")

            if len(parts) == 1:
                # 文件
                entries.append(FileInfo(
                    path=file_path,
                    is_dir=False,
                    modified_at=self._files[file_path].get("modified_at", ""),
                ))
            else:
                # 子目录
                dir_path = f"{path.rstrip('/')}/{parts[0]}/"
                if dir_path not in seen_dirs:
                    seen_dirs.add(dir_path)
                    entries.append(FileInfo(path=dir_path, is_dir=True))

        return LsResult(entries=entries)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        if file_path not in self._files:
            return ReadResult(error=f"File '{file_path}' not found")

        content = self._files[file_path]["content"]
        lines = content.splitlines(keepends=True)

        if offset >= len(lines):
            return ReadResult(error=f"Line offset {offset} exceeds file length ({len(lines)} lines)")

        sliced = "".join(lines[offset:offset + limit])
        return ReadResult(file_data=FileData(content=sliced, encoding="utf-8"))

    def write(self, file_path: str, content: str) -> WriteResult:
        if file_path in self._files:
            return WriteResult(error=f"File '{file_path}' already exists")

        self._files[file_path] = self._create_file_data(content)
        return WriteResult(path=file_path)

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:
        if file_path not in self._files:
            return EditResult(error=f"File '{file_path}' not found")

        content = self._files[file_path]["content"]
        result = perform_string_replacement(content, old_string, new_string, replace_all)

        if isinstance(result, str):
            return EditResult(error=result)

        new_content, occurrences = result
        self._files[file_path] = self._create_file_data(new_content)
        return EditResult(path=file_path, occurrences=occurrences)

    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult:
        matches = []
        search_path = path or "/"

        for file_path, file_data in self._files.items():
            if not file_path.startswith(search_path):
                continue

            # 简单的文本搜索
            for i, line in enumerate(file_data["content"].splitlines(), 1):
                if pattern in line:
                    matches.append({"path": file_path, "line": i, "text": line})

        return GrepResult(matches=matches)

    def glob(self, pattern: str, path: str = "/") -> GlobResult:
        import fnmatch

        matches = []
        for file_path in self._files:
            if fnmatch.fnmatch(file_path, pattern):
                matches.append(FileInfo(
                    path=file_path,
                    is_dir=False,
                    modified_at=self._files[file_path].get("modified_at", ""),
                ))

        return GlobResult(matches=matches)
```

## 沙箱后端示例

如果您需要在隔离环境中执行命令，可以实现 `SandboxBackendProtocol`：

```python
import subprocess

class MySandboxBackend(MemoryBackend, SandboxBackendProtocol):
    """带命令执行的内存后端"""

    @property
    def id(self) -> str:
        return "my-sandbox"

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        """执行 Shell 命令"""
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout or 60,
            )
            output = result.stdout + result.stderr
            return ExecuteResponse(
                output=output,
                exit_code=result.returncode,
                truncated=False,
            )
        except subprocess.TimeoutExpired:
            return ExecuteResponse(
                output="Command timed out",
                exit_code=-1,
                truncated=False,
            )
```

## 异步支持

实现异步版本以提高性能：

```python
class AsyncBackend(BackendProtocol):
    async def aread(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        """异步读取"""
        # 异步实现
        pass

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        """异步写入"""
        # 异步实现
        pass

    # 其他异步方法...
```

## 后端工厂

后端可以通过工厂函数动态创建：

```python
from langchain.tools import ToolRuntime

def create_backend(runtime: ToolRuntime) -> BackendProtocol:
    """后端工厂函数"""
    thread_id = runtime.state.get("thread_id", "default")
    user_id = runtime.state.get("user_id", "anonymous")

    # 根据用户创建隔离存储
    return MemoryBackend()


# 在 Agent 中使用
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=create_backend,
)
```

## 错误处理

### 标准错误码

```python
from deepagents.backends.protocol import (
    FILE_NOT_FOUND,
    PERMISSION_DENIED,
    IS_DIRECTORY,
    INVALID_PATH,
)

def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
    if not self._exists(file_path):
        return ReadResult(error=f"File '{file_path}' not found")

    if self._is_directory(file_path):
        return ReadResult(error=f"'{file_path}' is a directory")

    if not self._has_permission(file_path):
        return ReadResult(error="Permission denied")

    # 读取文件...
```

### 批量操作错误

```python
def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
    responses = []
    for path, content in files:
        try:
            self._write_bytes(path, content)
            responses.append(FileUploadResponse(path=path, error=None))
        except PermissionError:
            responses.append(FileUploadResponse(path=path, error=PERMISSION_DENIED))
        except Exception as e:
            responses.append(FileUploadResponse(path=path, error=str(e)))
    return responses
```

## 缓存优化

### 元数据缓存

```python
class CachedBackend(BackendProtocol):
    def __init__(self, backend: BackendProtocol):
        self._backend = backend
        self._file_cache: dict[str, tuple[float, FileData]] = {}

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        # 检查缓存
        if file_path in self._file_cache:
            cached_time, cached_data = self._file_cache[file_path]
            if time.time() - cached_time < 5:  # 5 秒缓存
                return ReadResult(file_data=cached_data)

        # 读取并缓存
        result = self._backend.read(file_path, offset, limit)
        if result.file_data:
            self._file_cache[file_path] = (time.time(), result.file_data)
        return result
```

### 搜索优化

```python
class IndexedBackend(BackendProtocol):
    def __init__(self, backend: BackendProtocol):
        self._backend = backend
        self._index: dict[str, list[str]] = {}  # 词 -> 文件列表

    def _update_index(self, file_path: str, content: str):
        # 更新索引
        words = set(content.lower().split())
        for word in words:
            if word not in self._index:
                self._index[word] = []
            if file_path not in self._index[word]:
                self._index[word].append(file_path)

    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult:
        # 使用索引加速搜索
        word = pattern.lower().split()[0]
        candidate_files = self._index.get(word, [])

        # 只搜索候选文件
        matches = []
        for file_path in candidate_files:
            result = self._backend.grep(pattern, file_path, glob)
            if result.matches:
                matches.extend(result.matches)

        return GrepResult(matches=matches)
```

## 集成示例

### 使用自定义后端

```python
from deepagents import create_deep_agent

# 创建自定义后端
backend = MyBackend()

# 在 Agent 中使用
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
)

# 或使用工厂函数
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=lambda runtime: MyBackend(thread_id=runtime.state.get("thread_id")),
)
```

### 组合多个后端

```python
from deepagents.backends import CompositeBackend, StateBackend

composite = CompositeBackend(
    default=StateBackend(),
    routes={
        "/custom/": MyBackend(),
    }
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=composite,
)
```

## 测试后端

```python
import pytest

def test_backend_write_and_read():
    backend = MyBackend()

    # 写入
    result = backend.write("/test.txt", "Hello, World!")
    assert result.error is None
    assert result.path == "/test.txt"

    # 读取
    result = backend.read("/test.txt")
    assert result.error is None
    assert "Hello, World!" in result.file_data["content"]

def test_backend_grep():
    backend = MyBackend()
    backend.write("/test1.txt", "Hello World")
    backend.write("/test2.txt", "Goodbye World")

    result = backend.grep("World")
    assert len(result.matches) == 2

def test_backend_error_handling():
    backend = MyBackend()

    # 读取不存在的文件
    result = backend.read("/nonexistent.txt")
    assert result.error is not None

    # 写入已存在的文件
    backend.write("/test.txt", "content")
    result = backend.write("/test.txt", "new content")
    assert "already exists" in result.error
```

## 下一步

- [BackendProtocol](../core/backend-protocol.md) - 后端协议定义
- [FilesystemBackend](../core/filesystem-backend.md) - 文件系统后端
- [Custom Middleware](./custom-middleware.md) - 自定义中间件