# HumanInTheLoop

Human-in-the-Loop (HITL) 通过文件系统权限系统控制 Agent 对文件和命令的访问，实现安全审查。

**源码路径**: `libs/deepagents/deepagents/middleware/filesystem.py`

## FilesystemPermission

```python
@dataclass
class FilesystemPermission:
    """文件系统操作访问规则"""
    operations: list[FilesystemOperation]  # 操作类型
    paths: list[str]  # 路径模式
    mode: Literal["allow", "deny"] = "allow"  # 允许或拒绝
```

### 操作类型

```python
FilesystemOperation = Literal["read", "write", "execute"]
```

- `read` - 读操作：ls, read_file, grep, glob
- `write` - 写操作：write_file, edit_file
- `execute` - 命令执行：execute

### 路径模式

支持 glob 通配符：
- `/etc/*` - 匹配 `/etc/` 下的直接文件
- `/etc/**` - 递归匹配 `/etc/` 下所有文件
- `/home/user/*.txt` - 匹配特定扩展名

## 权限检查

### 检查逻辑

```python
def _check_fs_permission(
    rules: list[FilesystemPermission],
    operation: FilesystemOperation,
    path: str,
) -> Literal["allow", "deny"]:
    """检查权限

    规则按顺序检查，第一个匹配的规则决定结果。
    默认允许。
    """
    for rule in rules:
        if operation not in rule.operations:
            continue
        if any(wcglob.globmatch(path, pattern) for pattern in rule.paths):
            return rule.mode
    return "allow"  # 默认允许
```

### 规则顺序

规则按定义顺序检查，第一个匹配的规则生效：

```python
rules = [
    FilesystemPermission(operations=["read"], paths=["/etc/**"], mode="deny"),  # 先匹配
    FilesystemPermission(operations=["read"], paths=["/etc/passwd"], mode="allow"),  # 永远不会匹配
]
```

正确顺序：

```python
rules = [
    FilesystemPermission(operations=["read"], paths=["/etc/passwd"], mode="allow"),  # 先匹配
    FilesystemPermission(operations=["read"], paths=["/etc/**"], mode="deny"),  # 后匹配
]
```

## 使用方式

### 通过 create_deep_agent

```python
from deepagents import create_deep_agent
from deepagents.middleware.filesystem import FilesystemPermission

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=FilesystemBackend(root_dir="/workspace"),
    # 内部创建 FilesystemMiddleware 并应用权限
)
```

### 通过 FilesystemMiddleware

```python
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission
from deepagents.backends import FilesystemBackend

backend = FilesystemBackend(root_dir="/workspace")

middleware = FilesystemMiddleware(
    backend=backend,
    _permissions=[
        # 允许读取项目文件
        FilesystemPermission(
            operations=["read"],
            paths=["/workspace/**"],
            mode="allow",
        ),
        # 拒绝写入敏感目录
        FilesystemPermission(
            operations=["write"],
            paths=["/workspace/.env*", "/workspace/secrets/**"],
            mode="deny",
        ),
        # 拒绝执行命令
        FilesystemPermission(
            operations=["execute"],
            paths=["/**"],
            mode="deny",
        ),
    ],
)
```

## 权限应用

### ls 工具

```python
def ls(path: str, runtime: ToolRuntime) -> str | ToolMessage:
    # 解析路径
    validated_path = _validate_path(path, runtime.state, resolved_backend)

    # 检查权限
    if _check_fs_permission(self._permissions, "read", validated_path) == "deny":
        return ToolMessage(
            content=f"Error: permission denied for read on {validated_path}",
            status="error",
        )

    # 执行操作
    ls_result = resolved_backend.ls(validated_path)

    # 过滤结果
    paths = _apply_permissions_to_ls_results(self._permissions, ls_result.entries)
    return str(paths)
```

### read_file 工具

```python
def read_file(file_path: str, runtime: ToolRuntime) -> str | ToolMessage:
    validated_path = _validate_path(file_path, ...)

    # 检查读权限
    if _check_fs_permission(self._permissions, "read", validated_path) == "deny":
        return ToolMessage(
            content=f"Error: permission denied for read on {validated_path}",
            status="error",
        )

    return resolved_backend.read(validated_path)
```

### write_file / edit_file 工具

```python
def write_file(file_path: str, content: str, runtime: ToolRuntime) -> str | ToolMessage:
    validated_path = _validate_path(file_path, ...)

    # 检查写权限
    if _check_fs_permission(self._permissions, "write", validated_path) == "deny":
        return ToolMessage(
            content=f"Error: permission denied for write on {validated_path}",
            status="error",
        )

    return resolved_backend.write(validated_path, content)
```

### execute 工具

```python
def execute(command: str, timeout: int | None, runtime: ToolRuntime) -> str | ToolMessage:
    # 检查执行权限（应用于所有路径）
    if _check_fs_permission(self._permissions, "execute", "/**") == "deny":
        return ToolMessage(
            content="Error: command execution is not allowed",
            status="error",
        )

    return resolved_backend.execute(command, timeout=timeout)
```

### grep / glob 工具

```python
def grep(pattern: str, path: str, glob: str, runtime: ToolRuntime) -> str | ToolMessage:
    result = resolved_backend.grep(pattern, path, glob)

    # 过滤结果
    filtered_matches = _filter_grep_matches_by_permission(
        self._permissions,
        result.matches,
        operation="read",
    )

    return str(filtered_matches)
```

## 常见配置

### 只读模式

```python
permissions = [
    # 允许读取所有文件
    FilesystemPermission(
        operations=["read"],
        paths=["/**"],
        mode="allow",
    ),
    # 拒绝所有写入
    FilesystemPermission(
        operations=["write"],
        paths=["/**"],
        mode="deny",
    ),
    # 拒绝执行
    FilesystemPermission(
        operations=["execute"],
        paths=["/**"],
        mode="deny",
    ),
]
```

### 敏感文件保护

```python
permissions = [
    # 拒绝访问敏感文件
    FilesystemPermission(
        operations=["read", "write"],
        paths=[
            "/**/.env*",
            "/**/secrets/**",
            "/**/credentials/**",
            "/etc/passwd",
            "/etc/shadow",
        ],
        mode="deny",
    ),
    # 允许其他操作
    FilesystemPermission(
        operations=["read", "write", "execute"],
        paths=["/**"],
        mode="allow",
    ),
]
```

### 项目隔离

```python
permissions = [
    # 只允许项目目录
    FilesystemPermission(
        operations=["read", "write"],
        paths=["/workspace/project/**"],
        mode="allow",
    ),
    # 拒绝其他目录
    FilesystemPermission(
        operations=["read", "write"],
        paths=["/**"],
        mode="deny",
    ),
]
```

### Temp 目录访问

```python
permissions = [
    # 允许临时目录
    FilesystemPermission(
        operations=["read", "write"],
        paths=["/tmp/**"],
        mode="allow",
    ),
    # 允许项目目录
    FilesystemPermission(
        operations=["read", "write"],
        paths=["/workspace/**"],
        mode="allow",
    ),
    # 拒绝其他
    FilesystemPermission(
        operations=["read", "write"],
        paths=["/**"],
        mode="deny",
    ),
]
```

## 与沙箱后端的限制

**重要**: 权限系统目前不支持 SandboxBackendProtocol：

```python
if (
    _permissions
    and isinstance(self.backend, BackendProtocol)
    and supports_execution(self.backend)
    and not _all_paths_scoped_to_routes(_permissions, self.backend)
):
    raise NotImplementedError(
        "FilesystemMiddleware does not yet support permissions with backends that "
        "provide command execution (SandboxBackendProtocol). Tool-level permissions "
        "for the execute tool are not implemented. Either remove permissions or use "
        "a backend without execution support."
    )
```

### 解决方案

1. 使用虚拟模式 FilesystemBackend：

```python
backend = FilesystemBackend(
    root_dir="/workspace",
    virtual_mode=True,  # 路径隔离
)
```

2. 使用 CompositeBackend 路由：

```python
composite = CompositeBackend(
    default=StateBackend(),
    routes={
        "/project/": FilesystemBackend(root_dir="/container/project"),
        "/tmp/": StateBackend(),
    },
)
```

## 最佳实践

### 1. 默认拒绝

```python
# ✅ 好：默认拒绝，显式允许
permissions = [
    FilesystemPermission(operations=["read"], paths=["/allowed/**"], mode="allow"),
    FilesystemPermission(operations=["read"], paths=["/**"], mode="deny"),
]

# ❌ 不好：默认允许，需要显式拒绝每个敏感路径
permissions = [
    FilesystemPermission(operations=["read"], paths=["/etc/passwd"], mode="deny"),
    FilemetricPermission(operations=["read"], paths=["/**"], mode="allow"),
]
```

### 2. 具体优先

```python
# ✅ 好：具体规则在前
permissions = [
    FilesystemPermission(operations=["write"], paths=["/config/local.yaml"], mode="allow"),
    FilesystemPermission(operations=["write"], paths=["/config/**"], mode="deny"),
]
```

### 3. 最小权限

```python
# ✅ 好：只授予必要的权限
permissions = [
    FilesystemPermission(operations=["read"], paths=["/data/input/**"], mode="allow"),
    FilesystemPermission(operations=["write"], paths=["/data/output/**"], mode="allow"),
    FilesystemPermission(operations=["read", "write"], paths=["/**"], mode="deny"),
]
```

### 4. 生产环境

```python
# 生产环境推荐配置
permissions = [
    # 允许项目目录
    FilesystemPermission(
        operations=["read", "write"],
        paths=["/workspace/**"],
        mode="allow",
    ),
    # 拒绝敏感文件
    FilesystemPermission(
        operations=["read", "write"],
        paths=[
            "/**/.env*",
            "/**/secrets/**",
            "/**/credentials/**",
            "/**/*token*",
            "/**/*key*.pem",
        ],
        mode="deny",
    ),
    # 拒绝执行
    FilesystemPermission(
        operations=["execute"],
        paths=["/**"],
        mode="deny",
    ),
]
```

## 下一步

- [FilesystemMiddleware](./filesystem-middleware.md) - 文件系统中间件
- [FilesystemBackend](./filesystem-backend.md) - 文件系统后端
- [最佳实践](../advanced/best-practices.md) - 安全实践