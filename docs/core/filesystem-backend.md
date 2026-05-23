# FilesystemBackend

FilesystemBackend 直接读写本地文件系统，是最常用的持久化后端。

**源码路径**: `libs/deepagents/deepagents/backends/filesystem.py`

## 特点

- 直接访问本地文件系统
- 支持相对路径和绝对路径
- 可选虚拟模式提供路径安全检查
- 优先使用 ripgrep 进行搜索
- 支持大文件搜索限制

## 初始化

```python
class FilesystemBackend(BackendProtocol):
    def __init__(
        self,
        root_dir: str | Path | None = None,
        virtual_mode: bool | None = None,
        max_file_size_mb: int = 10,
    ):
        self.cwd = Path(root_dir).resolve() if root_dir else Path.cwd()
        self.virtual_mode = virtual_mode
        self.max_file_size_bytes = max_file_size_mb * 1024 * 1024
```

### 参数说明

- **root_dir**: 根目录，默认为当前工作目录
- **virtual_mode**: 虚拟模式，提供路径安全检查
- **max_file_size_mb**: 搜索时的最大文件大小限制

## 虚拟模式

### virtual_mode=False（默认）

```python
backend = FilesystemBackend(root_dir="/workspace", virtual_mode=False)

# 绝对路径：直接使用
backend.read("/etc/passwd")  # 可以读取任何可访问文件

# 相对路径：相对于 root_dir
backend.read("config.yaml")  # 解析为 /workspace/config.yaml

# 路径遍历：允许
backend.read("../../secrets/.env")  # 可以跳出 root_dir
```

### virtual_mode=True

```python
backend = FilesystemBackend(root_dir="/workspace", virtual_mode=True)

# 所有路径视为虚拟路径
backend.read("/config.yaml")  # 映射到 /workspace/config.yaml
backend.read("data.json")  # 映射到 /workspace/data.json

# 路径遍历：阻止
backend.read("../../secrets/.env")  # 抛出 ValueError
backend.read("~/../etc/passwd")  # 抛出 ValueError
```

## 路径解析

```python
def _resolve_path(self, key: str) -> Path:
    """安全解析路径"""
    if self.virtual_mode:
        # 虚拟模式：所有路径相对于 root_dir
        vpath = key if key.startswith("/") else "/" + key
        if ".." in vpath or vpath.startswith("~"):
            raise ValueError("Path traversal not allowed")
        full = (self.cwd / vpath.lstrip("/")).resolve()
        full.relative_to(self.cwd)  # 验证在 root_dir 内
        return full

    # 默认模式：绝对路径直接使用，相对路径相对于 root_dir
    path = Path(key)
    if path.is_absolute():
        return path
    return (self.cwd / path).resolve()
```

## 文件操作

### read - 读取文件

```python
def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
    """读取文件内容

    - 支持分页（offset/limit）
    - 自动检测文件类型（文本/二进制）
    - 二进制文件返回 base64 编码
    """
```

### write - 写入文件

```python
def write(self, file_path: str, content: str) -> WriteResult:
    """创建新文件

    - 如果文件已存在则返回错误
    - 自动创建父目录
    - 使用 O_NOFOLLOW 防止符号链接攻击
    """
```

### edit - 编辑文件

```python
def edit(
    self,
    file_path: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
) -> EditResult:
    """字符串替换编辑

    - 精确匹配替换
    - replace_all=True 替换所有匹配
    - 自动规范化行结束符
    """
```

### ls - 列出目录

```python
def ls(self, path: str) -> LsResult:
    """列出目录内容

    - 非递归
    - 返回文件元数据（大小、修改时间）
    - 目录路径以 / 结尾
    """
```

## 搜索功能

### grep - 文本搜索

```python
def grep(
    self,
    pattern: str,
    path: str | None = None,
    glob: str | None = None,
) -> GrepResult:
    """搜索文本模式

    - 优先使用 ripgrep（更快）
    - 自动回退到 Python 搜索
    - 支持通配符过滤
    """
```

**使用示例**:

```python
# 搜索所有文件
backend.grep("TODO")

# 在特定目录搜索
backend.grep("error", path="/src")

# 使用通配符过滤
backend.grep("import", glob="*.py")
```

### glob - 文件匹配

```python
def glob(self, pattern: str, path: str = "/") -> GlobResult:
    """glob 模式匹配文件

    - 递归搜索
    - 支持 ** 通配符
    """
```

**使用示例**:

```python
# 匹配所有 Python 文件
backend.glob("**/*.py")

# 匹配特定目录
backend.glob("docs/*.md", path="/project")
```

## 批量操作

### upload_files - 批量上传

```python
def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
    """批量写入文件

    - 自动创建父目录
    - 覆盖已存在的文件
    - 返回每个文件的结果
    """
```

### download_files - 批量下载

```python
def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
    """批量读取文件

    - 返回原始字节
    - 处理符号链接
    """
```

## 安全特性

### 1. 符号链接检查

```python
def _raise_if_symlink_loop(path: Path) -> None:
    """检测符号链接循环"""
    if not path.is_symlink():
        return
    try:
        path.stat()
    except OSError as exc:
        if _is_eloop_oserror(exc):
            raise
```

### 2. 路径规范化

```python
# 解析路径时检查：
# 1. 符号链接循环
# 2. 路径遍历（virtual_mode）
# 3. 路径是否在 root_dir 内（virtual_mode）
```

### 3. 文件打开标志

```python
# 使用 O_NOFOLLOW 防止符号链接攻击
flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
fd = os.open(resolved_path, flags, 0o644)
```

## 搜索实现

### ripgrep 优先

```python
def _ripgrep_search(self, pattern: str, base_full: Path, include_glob: str | None):
    """使用 ripgrep 搜索

    - --json: JSON 输出格式
    - -F: 字面搜索（非正则）
    - 30 秒超时
    """
    cmd = ["rg", "--json", "-F"]
    if include_glob:
        cmd.extend(["--glob", include_glob])
    cmd.extend(["--", pattern, "."])
```

### Python 回退

```python
def _python_search(self, pattern: str, base_full: Path, include_glob: str | None):
    """Python 搜索回退

    - 跳过超大文件
    - 使用正则表达式
    - 支持通配符过滤
    """
    regex = re.compile(pattern)
    for fp in root.rglob("*"):
        if fp.stat().st_size > self.max_file_size_bytes:
            continue
        # 搜索文件内容...
```

## 使用示例

```python
from deepagents.backends import FilesystemBackend
from deepagents import create_deep_agent

# 创建后端
backend = FilesystemBackend(
    root_dir="/workspace",
    virtual_mode=True,  # 启用路径安全检查
)

# 基本操作
result = backend.read("/src/main.py")
result = backend.write("/src/new.py", "# New file\n")
result = backend.edit("/src/main.py", "old", "new")

# 搜索
matches = backend.grep("TODO", glob="*.py")
files = backend.glob("docs/**/*.md")

# 配合 Agent 使用
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
)
```

## 安全警告

> **注意**: FilesystemBackend 授予 Agent 直接文件系统访问权限。请谨慎使用：
>
> **适用场景**:
> - 本地开发 CLI 工具
> - CI/CD 流水线
> - 可信环境
>
> **不适用场景**:
> - Web 服务器
> - HTTP API
> - 不可信工作负载
>
> **推荐安全措施**:
> 1. 启用 Human-in-the-Loop 中间件
> 2. 使用 virtual_mode=True
> 3. 隔离敏感文件
> 4. 生产环境使用 StateBackend 或 SandboxBackend

## 下一步

- [StateBackend](./state-backend.md) - 状态存储后端
- [CompositeBackend](./composite-backend.md) - 组合路由后端
- [BackendProtocol](./backend-protocol.md) - 后端协议定义