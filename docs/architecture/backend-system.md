# 后端系统

后端是 Deep Agents 文件存储和执行的抽象层。本文档将深入分析后端协议、不同后端的实现差异以及如何选择合适的后端。

## BackendProtocol 协议

**源码路径**: `libs/deepagents/deepagents/backends/protocol.py`

后端协议定义了所有后端必须实现的核心接口：

```python
class BackendProtocol(abc.ABC):
    """后端协议基类"""

    # ============ 目录操作 ============

    def ls(self, path: str) -> LsResult:
        """列出目录内容"""
        raise NotImplementedError

    async def als(self, path: str) -> LsResult:
        """异步列出目录"""
        return await asyncio.to_thread(self.ls, path)

    # ============ 文件操作 ============

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        """读取文件内容"""
        raise NotImplementedError

    async def aread(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        """异步读取文件"""
        return await asyncio.to_thread(self.read, file_path, offset, limit)

    def write(self, file_path: str, content: str) -> WriteResult:
        """写入新文件"""
        raise NotImplementedError

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        """异步写入文件"""
        return await asyncio.to_thread(self.write, file_path, content)

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:
        """编辑现有文件"""
        raise NotImplementedError

    async def aedit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:
        """异步编辑文件"""
        return await asyncio.to_thread(self.edit, file_path, old_string, new_string, replace_all)

    # ============ 搜索操作 ============

    def glob(self, pattern: str, path: str = "/") -> GlobResult:
        """模式匹配搜索"""
        raise NotImplementedError

    async def aglob(self, pattern: str, path: str = "/") -> GlobResult:
        """异步模式匹配"""
        return await asyncio.to_thread(self.glob, pattern, path)

    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult:
        """文本搜索"""
        raise NotImplementedError

    async def agrep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult:
        """异步文本搜索"""
        return await asyncio.to_thread(self.grep, pattern, path, glob)

    # ============ 批量操作 ============

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """批量上传文件"""
        raise NotImplementedError

    async def aupload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """异步批量上传"""
        return await asyncio.to_thread(self.upload_files, files)

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """批量下载文件"""
        raise NotImplementedError

    async def adownload_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """异步批量下载"""
        return await asyncio.to_thread(self.download_files, paths)
```

### 扩展协议：SandboxBackendProtocol

```python
class SandboxBackendProtocol(BackendProtocol):
    """沙箱后端协议（扩展执行能力）"""

    @property
    def id(self) -> str:
        """沙箱唯一标识"""
        raise NotImplementedError

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        """执行 Shell 命令"""
        raise NotImplementedError

    async def aexecute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        """异步执行命令"""
        return await asyncio.to_thread(self.execute, command, timeout=timeout)
```

### 数据类型

```python
@dataclass
class FileInfo(TypedDict):
    """文件信息"""
    path: str              # 文件路径
    is_dir: NotRequired[bool]  # 是否目录
    size: NotRequired[int]     # 文件大小
    modified_at: NotRequired[str]  # 修改时间

@dataclass
class FileData(TypedDict):
    """文件数据"""
    content: str           # 内容（UTF-8 文本或 Base64 二进制）
    encoding: str          # 编码："utf-8" 或 "base64"
    created_at: NotRequired[str]
    modified_at: NotRequired[str]

@dataclass
class LsResult:
    """目录列表结果"""
    error: str | None = None
    entries: list["FileInfo"] | None = None

@dataclass
class ReadResult:
    """读取结果"""
    error: str | None = None
    file_data: FileData | None = None

@dataclass
class WriteResult:
    """写入结果"""
    error: str | None = None
    path: str | None = None

@dataclass
class EditResult:
    """编辑结果"""
    error: str | None = None
    path: str | None = None
    occurrences: int | None = None  # 替换次数

@dataclass
class ExecuteResponse:
    """命令执行结果"""
    output: str              # 合并的 stdout/stderr
    exit_code: int | None    # 退出码
    truncated: bool = False  # 是否被截断
```

## StateBackend

**源码路径**: `libs/deepagents/deepagents/backends/state.py`

**特点**：
- 文件存储在 LangGraph Agent State 中
- 临时的、会话级存储
- 状态自动 Checkpoint
- 默认后端

**核心实现**：

```python
class StateBackend(BackendProtocol):
    """状态后端：文件存储在 Agent State 中"""

    def __init__(self, runtime: object = None, *, file_format: FileFormat = "v2"):
        # runtime 参数已弃用，现在通过 LangGraph 配置访问状态
        self._file_format = file_format

    def _get_config(self) -> RunnableConfig:
        """获取 LangGraph 配置"""
        config = get_config()
        if CONFIG_KEY_READ not in config.get("configurable", {}):
            raise RuntimeError("StateBackend 必须在 LangGraph 图执行中使用")
        return config

    def _read_files(self) -> dict[str, Any]:
        """读取 files 通道"""
        config = self._get_config()
        read = config["configurable"][CONFIG_KEY_READ]
        return read("files", fresh=True) or {}

    def _send_files_update(self, update: dict[str, Any]) -> None:
        """发送 files 更新"""
        config = self._get_config()
        send = config["configurable"][CONFIG_KEY_SEND]
        send([("files", update)])

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        """读取文件"""
        files = self._read_files()
        file_data = files.get(file_path)

        if file_data is None:
            return ReadResult(error=f"File '{file_path}' not found")

        # 支持分页读取
        content = file_data_to_string(file_data)
        lines = content.splitlines(keepends=True)
        sliced = "".join(lines[offset:offset + limit])

        return ReadResult(file_data={
            "content": sliced,
            "encoding": file_data.get("encoding", "utf-8"),
        })

    def write(self, file_path: str, content: str) -> WriteResult:
        """写入文件"""
        files = self._read_files()

        if file_path in files:
            return WriteResult(error=f"File '{file_path}' already exists")

        new_file_data = create_file_data(content)
        self._send_files_update({file_path: new_file_data})

        return WriteResult(path=file_path)

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:
        """编辑文件"""
        files = self._read_files()
        file_data = files.get(file_path)

        if file_data is None:
            return EditResult(error=f"File '{file_path}' not found")

        content = file_data_to_string(file_data)
        result = perform_string_replacement(content, old_string, new_string, replace_all)

        if isinstance(result, str):
            return EditResult(error=result)

        new_content, occurrences = result
        new_file_data = update_file_data(file_data, new_content)
        self._send_files_update({file_path: new_file_data})

        return EditResult(path=file_path, occurrences=int(occurrences))
```

**使用场景**：
- 临时文件存储
- 测试和开发
- 不需要持久化的会话

**限制**：
- 不支持命令执行
- 文件随会话结束而消失
- 大量文件可能影响状态大小

## FilesystemBackend

**源码路径**: `libs/deepagents/deepagents/backends/filesystem.py`

**特点**：
- 文件存储在本地文件系统
- 支持沙箱模式（限制路径访问）
- 适合本地开发和测试

**核心实现**：

```python
class FilesystemBackend(SandboxBackendProtocol):
    """文件系统后端"""

    def __init__(
        self,
        root_dir: str = "/",
        *,
        virtual_mode: bool = False,  # 虚拟模式（路径重写）
    ):
        self._root_dir = os.path.abspath(root_dir)
        self._virtual_mode = virtual_mode

    def _resolve_path(self, path: str) -> str:
        """解析路径到实际文件系统路径"""
        # 安全检查：防止路径遍历攻击
        resolved = os.path.normpath(os.path.join(self._root_dir, path.lstrip("/")))
        if not resolved.startswith(self._root_dir):
            raise ValueError(f"Path traversal detected: {path}")
        return resolved

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        """读取文件"""
        try:
            resolved_path = self._resolve_path(file_path)

            with open(resolved_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
                sliced = lines[offset:offset + limit]
                content = "".join(sliced)

            return ReadResult(file_data={
                "content": content,
                "encoding": "utf-8",
            })
        except FileNotFoundError:
            return ReadResult(error=f"File '{file_path}' not found")
        except Exception as e:
            return ReadResult(error=str(e))
```

**使用场景**：
- 本地开发
- 访问本地项目文件
- 与本地工具集成

**限制**：
- 不支持命令执行（仅文件操作）
- 需要适当的文件系统权限

## SandboxBackend

**源码路径**: `libs/deepagents/deepagents/backends/sandbox.py`

**特点**：
- 在隔离环境（容器/VM）中执行命令
- 支持远程沙箱
- 适合生产环境

**核心实现**：

```python
class SandboxBackend(SandboxBackendProtocol):
    """沙箱后端（抽象基类）"""

    @property
    def id(self) -> str:
        """沙箱唯一标识"""
        raise NotImplementedError

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        """在沙箱中执行命令"""
        raise NotImplementedError

    # 文件操作基于 execute 实现
    def ls(self, path: str) -> LsResult:
        """列出目录（通过 shell 命令）"""
        result = self.execute(f"ls -la {shlex.quote(path)}")
        if result.exit_code != 0:
            return LsResult(error=result.output)

        entries = self._parse_ls_output(result.output)
        return LsResult(entries=entries)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        """读取文件（通过 shell 命令）"""
        # 使用 sed/tail/head 实现分页
        if offset > 0:
            cmd = f"sed -n '{offset+1},{offset+limit}p' {shlex.quote(file_path)}"
        else:
            cmd = f"head -n {limit} {shlex.quote(file_path)}"

        result = self.execute(cmd)
        if result.exit_code != 0:
            return ReadResult(error=result.output)

        return ReadResult(file_data={"content": result.output, "encoding": "utf-8"})
```

**合作伙伴实现**：
- `libs/partners/daytona`：Daytona 沙箱
- `libs/partners/modal`：Modal 沙箱
- `libs/partners/runloop`：RunLoop 沙箱
- `libs/partners/quickjs`：QuickJS 沙箱（JavaScript）

**使用场景**：
- 生产环境
- 需要 Shell 命令执行
- 需要 isolation

## CompositeBackend

**源码路径**: `libs/deepagents/deepagents/backends/composite.py`

**特点**：
- 组合多个后端
- 根据路径前缀路由
- 支持混合存储策略

**核心实现**：

```python
class CompositeBackend(BackendProtocol):
    """组合后端：根据路径前缀路由到不同后端"""

    def __init__(
        self,
        default: BackendProtocol,
        routes: dict[str, BackendProtocol],
    ):
        self.default = default
        self.routes = routes  # {"/memories/": StoreBackend, "/sandbox/": SandboxBackend}
        self._sorted_prefixes = sorted(routes.keys(), key=len, reverse=True)

    def _get_backend(self, path: str) -> BackendProtocol:
        """根据路径选择后端"""
        for prefix in self._sorted_prefixes:
            if path.startswith(prefix):
                return self.routes[prefix]
        return self.default

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        """读取文件"""
        backend = self._get_backend(file_path)
        return backend.read(file_path, offset, limit)

    def write(self, file_path: str, content: str) -> WriteResult:
        """写入文件"""
        backend = self._get_backend(file_path)
        return backend.write(file_path, content)
```

**使用示例**：

```python
from deepagents.backends import CompositeBackend, StateBackend
from deepagents.backends.store import StoreBackend
from langsmith import Client

backend = CompositeBackend(
    default=StateBackend(),  # 默认使用状态存储
    routes={
        "/memories/": StoreBackend(  # 持久化存储
            client=Client(),
            store_name="memories",
        ),
        "/sandbox/": SandboxBackend(...),  # 沙箱执行
    },
)
```

## 后端选择指南

| 后端 | 存储位置 | 执行能力 | 持久化 | 适用场景 |
|------|----------|----------|--------|----------|
| StateBackend | Agent State | ❌ | Checkpoint | 临时文件、测试 |
| FilesystemBackend | 本地文件系统 | ❌ | 文件系统 | 本地开发 |
| SandboxBackend | 沙箱环境 | ✅ | 沙箱配置 | 生产环境 |
| CompositeBackend | 多后端路由 | 取决于路由 | 取决于路由 | 混合场景 |

## 下一步

- [BackendProtocol](/core/backend-protocol)：深入理解后端协议
- [StateBackend](/core/state-backend)：深入理解状态后端
- [自定义后端](/advanced/custom-backend)：学习如何实现自定义后端