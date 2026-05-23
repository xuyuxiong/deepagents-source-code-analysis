# BackendProtocol

BackendProtocol 是 Deep Agents 的文件存储抽象层，定义了所有后端必须实现的接口。

**源码路径**: `libs/deepagents/deepagents/backends/protocol.py`

## 核心接口

### BackendProtocol

```python
class BackendProtocol(abc.ABC):
    """可插拔后端协议"""

    # 文件操作
    def ls(self, path: str) -> LsResult
    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult
    def write(self, file_path: str, content: str) -> WriteResult
    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult

    # 搜索操作
    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult
    def glob(self, pattern: str, path: str = "/") -> GlobResult

    # 批量操作
    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]
    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]
```

### SandboxBackendProtocol

```python
class SandboxBackendProtocol(BackendProtocol):
    """扩展 BackendProtocol，添加命令执行能力"""

    @property
    def id(self) -> str:
        """沙箱唯一标识符"""

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        """在沙箱环境中执行 Shell 命令"""
```

## 数据结构

### FileData

```python
class FileData(TypedDict):
    """文件数据结构"""
    content: str  # 文本内容或 base64 编码的二进制
    encoding: str  # "utf-8" 或 "base64"
    created_at: NotRequired[str]  # ISO 8601 时间戳
    modified_at: NotRequired[str]  # ISO 8601 时间戳
```

### FileInfo

```python
class FileInfo(TypedDict):
    """文件信息"""
    path: str  # 文件路径
    is_dir: NotRequired[bool]  # 是否为目录
    size: NotRequired[int]  # 文件大小（字节）
    modified_at: NotRequired[str]  # ISO 8601 时间戳
```

### GrepMatch

```python
class GrepMatch(TypedDict):
    """Grep 搜索结果"""
    path: str  # 文件路径
    line: int  # 行号（从 1 开始）
    text: str  # 匹配的行内容
```

## 结果类型

### ReadResult

```python
@dataclass
class ReadResult:
    error: str | None = None
    file_data: FileData | None = None
```

### WriteResult

```python
@dataclass
class WriteResult:
    error: str | None = None
    path: str | None = None
```

### EditResult

```python
@dataclass
class EditResult:
    error: str | None = None
    path: str | None = None
    occurrences: int | None = None  # 替换次数
```

### LsResult

```python
@dataclass
class LsResult:
    error: str | None = None
    entries: list[FileInfo] | None = None
```

### GrepResult

```python
@dataclass
class GrepResult:
    error: str | None = None
    matches: list[GrepMatch] | None = None
```

### GlobResult

```python
@dataclass
class GlobResult:
    error: str | None = None
    matches: list[FileInfo] | None = None
```

## 执行响应

### ExecuteResponse

```python
@dataclass
class ExecuteResponse:
    """命令执行结果"""
    output: str  # stdout 和 stderr 合并输出
    exit_code: int | None = None  # 退出码，0 表示成功
    truncated: bool = False  # 输出是否被截断
```

## 错误码

```python
FileOperationError = Literal[
    "file_not_found",  # 文件不存在
    "permission_denied",  # 权限拒绝
    "is_directory",  # 是目录不是文件
    "invalid_path",  # 路径无效
]
```

## 异步支持

所有方法都有对应的异步版本：

```python
# 同步
result = backend.read("/path/to/file")

# 异步
result = await backend.aread("/path/to/file")
```

异步方法列表：
- `als()` - 异步列出目录
- `aread()` - 异步读取文件
- `awrite()` - 异步写入文件
- `aedit()` - 异步编辑文件
- `agrep()` - 异步搜索
- `aglob()` - 异步 glob 匹配
- `aupload_files()` - 异步上传文件
- `adownload_files()` - 异步下载文件
- `aexecute()` - 异步执行命令（仅 SandboxBackendProtocol）

## 后端工厂

```python
BackendFactory: TypeAlias = Callable[[ToolRuntime], BackendProtocol]
BACKEND_TYPES = BackendProtocol | BackendFactory
```

后端可以通过工厂函数动态创建，便于访问运行时状态：

```python
def create_backend(runtime: ToolRuntime) -> BackendProtocol:
    thread_id = runtime.state.get("thread_id")
    return StateBackend(thread_id=thread_id)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=create_backend,
)
```

## 使用示例

```python
from deepagents.backends import FilesystemBackend, StateBackend
from deepagents import create_deep_agent

# 文件系统后端
backend = FilesystemBackend(root_dir="/app/workspace")

# 状态后端（临时会话存储）
backend = StateBackend()

# 在 Agent 中使用
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
)
```

## 下一步

- [FilesystemBackend](./filesystem-backend.md) - 本地文件系统后端
- [StateBackend](./state-backend.md) - 状态存储后端
- [CompositeBackend](./composite-backend.md) - 组合路由后端