# CompositeBackend

CompositeBackend 实现基于路径前缀的路由后端，将不同路径的文件操作分发到不同的后端。

**源码路径**: `libs/deepagents/deepagents/backends/composite.py`

## 核心概念

CompositeBackend 允许你为不同路径配置不同的存储策略：

```python
composite = CompositeBackend(
    default=StateBackend(),  # 默认后端
    routes={
        "/memories/": StoreBackend(),  # 持久化记忆
        "/cache/": StateBackend(),  # 临时缓存
    }
)
```

## 初始化

```python
class CompositeBackend(BackendProtocol):
    def __init__(
        self,
        default: BackendProtocol | StateBackend,
        routes: dict[str, BackendProtocol],
        *,
        artifacts_root: str = "/",
    ):
        self.default = default
        self.routes = routes
        self.sorted_routes = sorted(routes.items(), key=lambda x: len(x[0]), reverse=True)
        self.artifacts_root = artifacts_root
```

### 参数说明

- **default**: 默认后端，处理未匹配路由的请求
- **routes**: 路由映射，键为路径前缀，值为后端实例
- **artifacts_root**: 工件根路径，用于中间件存储

## 路由规则

### 最长前缀匹配

路由按前缀长度排序（最长优先）：

```python
self.sorted_routes = sorted(
    routes.items(),
    key=lambda x: len(x[0]),
    reverse=True
)
```

### 路径规范化

```python
def _route_for_path(
    *,
    default: BackendProtocol,
    sorted_routes: list[tuple[str, BackendProtocol]],
    path: str,
) -> tuple[BackendProtocol, str, str | None]:
    """路由路径到后端

    返回：(后端, 规范化路径, 匹配的路由前缀)
    """
    for route_prefix, backend in sorted_routes:
        prefix_no_slash = route_prefix.rstrip("/")
        if path == prefix_no_slash:
            return backend, "/", route_prefix

        normalized_prefix = route_prefix if route_prefix.endswith("/") else f"{route_prefix}/"
        if path.startswith(normalized_prefix):
            suffix = path[len(normalized_prefix):]
            backend_path = f"/{suffix}" if suffix else "/"
            return backend, backend_path, route_prefix

    return default, path, None
```

## 文件操作路由

### read/write/edit

```python
def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
    backend, stripped_key = self._get_backend_and_key(file_path)
    return backend.read(stripped_key, offset=offset, limit=limit)

def write(self, file_path: str, content: str) -> WriteResult:
    backend, stripped_key = self._get_backend_and_key(file_path)
    res = backend.write(stripped_key, content)
    if res.path is not None:
        res.path = file_path  # 恢复原始路径
    return res
```

### ls - 目录列出

```python
def ls(self, path: str) -> LsResult:
    backend, backend_path, route_prefix = _route_for_path(...)

    if route_prefix is not None:
        # 列出特定路由的目录
        ls_result = backend.ls(backend_path)
        return LsResult(entries=[
            _remap_file_info_path(fi, route_prefix)
            for fi in ls_result.entries
        ])

    if path == "/":
        # 根目录：聚合默认后端和所有路由
        results = []
        results.extend(self.default.ls(path).entries)
        for route_prefix, _ in self.sorted_routes:
            results.append(FileInfo(path=route_prefix, is_dir=True, size=0))
        return LsResult(entries=results)

    # 其他路径：查询默认后端
    return self.default.ls(path)
```

### grep - 文本搜索

```python
def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult:
    if path is not None:
        # 特定路径：搜索对应后端
        backend, backend_path, route_prefix = _route_for_path(...)
        if route_prefix is not None:
            grep_result = backend.grep(pattern, backend_path, glob)
            return GrepResult(matches=[
                _remap_grep_path(m, route_prefix)
                for m in grep_result.matches
            ])

    if path is None or path == "/":
        # 全局搜索：搜索所有后端
        all_matches = []
        all_matches.extend(self.default.grep(pattern, path, glob).matches)
        for route_prefix, backend in self.routes.items():
            result = backend.grep(pattern, "/", glob)
            all_matches.extend(_remap_grep_path(m, route_prefix) for m in result.matches)
        return GrepResult(matches=all_matches)

    # 其他路径：搜索默认后端
    return self.default.grep(pattern, path, glob)
```

### glob - 模式匹配

```python
def glob(self, pattern: str, path: str = "/") -> GlobResult:
    backend, backend_path, route_prefix = _route_for_path(...)

    if route_prefix is not None:
        # 匹配特定路由
        glob_result = backend.glob(pattern, backend_path)
        return GlobResult(matches=[
            _remap_file_info_path(fi, route_prefix)
            for fi in glob_result.matches
        ])

    # 聚合所有后端
    results = []
    results.extend(self.default.glob(pattern, path).matches)
    for route_prefix, backend in self.routes.items():
        route_pattern = _strip_route_from_pattern(pattern, route_prefix)
        sub_result = backend.glob(route_pattern, "/")
        results.extend(_remap_file_info_path(fi, route_prefix) for fi in sub_result.matches)

    return GlobResult(matches=results)
```

## 批量操作优化

批量操作按后端分组，减少调用次数：

```python
def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
    # 按后端分组
    backend_batches: dict[BackendProtocol, list[tuple[int, str, bytes]]] = defaultdict(list)

    for idx, (path, content) in enumerate(files):
        backend, stripped_path = self._get_backend_and_key(path)
        backend_batches[backend].append((idx, stripped_path, content))

    # 批量调用每个后端
    results: list[FileUploadResponse | None] = [None] * len(files)
    for backend, batch in backend_batches.items():
        indices, stripped_paths, contents = zip(*batch)
        batch_responses = backend.upload_files(list(zip(stripped_paths, contents)))

        for i, orig_idx in enumerate(indices):
            results[orig_idx] = FileUploadResponse(
                path=files[orig_idx][0],
                error=batch_responses[i].error if i < len(batch_responses) else None,
            )

    return results
```

## execute - 命令执行

命令执行总是委托给默认后端：

```python
def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
    if isinstance(self.default, SandboxBackendProtocol):
        if timeout is not None and execute_accepts_timeout(type(self.default)):
            return self.default.execute(command, timeout=timeout)
        return self.default.execute(command)

    raise NotImplementedError(
        "Default backend doesn't support command execution (SandboxBackendProtocol)."
    )
```

## 路径重映射

### FileInfo 重映射

```python
def _remap_file_info_path(fi: FileInfo, route_prefix: str) -> FileInfo:
    """将后端路径重映射到路由路径"""
    return {
        **fi,
        "path": f"{route_prefix[:-1]}{fi['path']}",  # 移除重复的 /
    }
```

### GrepMatch 重映射

```python
def _remap_grep_path(m: GrepMatch, route_prefix: str) -> GrepMatch:
    """重映射搜索结果路径"""
    return {
        **m,
        "path": f"{route_prefix[:-1]}{m['path']}",
    }
```

### glob 模式处理

```python
def _strip_route_from_pattern(pattern: str, route_prefix: str) -> str:
    """从 glob 模式中移除路由前缀"""
    bare_pattern = pattern.lstrip("/")
    bare_prefix = route_prefix.strip("/") + "/"
    if bare_pattern.startswith(bare_prefix):
        return bare_pattern[len(bare_prefix):]
    return pattern
```

## 使用示例

### 场景 1: 持久化记忆 + 临时文件

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend

composite = CompositeBackend(
    default=StateBackend(),  # 临时会话文件
    routes={
        "/memories/": StoreBackend(),  # 持久化记忆
    }
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=composite,
    memory=["/memories/AGENTS.md"],  # 记忆存储在持久化后端
)
```

### 场景 2: 多项目工作区

```python
composite = CompositeBackend(
    default=StateBackend(),
    routes={
        "/project-a/": FilesystemBackend(root_dir="/workspace/project-a"),
        "/project-b/": FilesystemBackend(root_dir="/workspace/project-b"),
        "/shared/": FilesystemBackend(root_dir="/workspace/shared"),
    }
)

# 访问项目 A 的文件
backend.read("/project-a/src/main.py")

# 访问共享文件
backend.read("/shared/config.yaml")
```

### 场景 3: 隔离测试环境

```python
composite = CompositeBackend(
    default=FilesystemBackend(root_dir="/workspace"),
    routes={
        "/test-fixtures/": StateBackend(),  # 测试 fixtures 在内存中
        "/artifacts/": StoreBackend(),  # 构建产物持久化
    }
)
```

## artifacts_root 配置

```python
composite = CompositeBackend(
    default=StateBackend(),
    routes={"/memories/": StoreBackend()},
    artifacts_root="/artifacts",  # 工件存储路径
)

# 中间件会将工件存储到此路径
# 例如：/artifacts/conversation_history/{thread_id}.md
```

## 注意事项

1. **路由前缀格式**: 建议以 `/` 结尾（如 `/memories/`）
2. **最长匹配**: 更长的前缀优先匹配
3. **执行限制**: `execute()` 只委托给默认后端
4. **路径一致性**: 路径会被规范化并重映射

## 下一步

- [BackendProtocol](./backend-protocol.md) - 后端协议定义
- [StateBackend](./state-backend.md) - 状态存储后端
- [FilesystemBackend](./filesystem-backend.md) - 文件系统后端