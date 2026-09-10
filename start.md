# AI 数分助手本地运行手册

本文用于 Windows 开发环境的日常启动、停止和故障排查。产品能力和系统架构见 [README.md](README.md)，完整验收要求见 [测试.md](测试.md)。

## 1. 服务清单

| 服务 | 本机端口 | 启动方式 |
| --- | --- | --- |
| React 前端 | `5173` | 本机进程 |
| FastAPI 后端 | `8000` | 本机进程 |
| MySQL | `3307` | Docker |
| Elasticsearch | `9200` | Docker |
| Kibana | `5601` | Docker |
| Qdrant HTTP / gRPC | `6333` / `6334` | Docker |
| Embedding | `8086` | Docker |

## 2. 首次准备

首次运行或依赖发生变化时执行：

```powershell
uv sync
cd frontend
pnpm install
cd ..
```

复制 `.env.example` 为 `.env`，并配置：

```dotenv
LLM_API_KEY=your_api_key_here
VOLCENGINE_TTS_API_KEY=your_volcengine_tts_api_key_here
VOLCENGINE_TTS_VOICE_TYPE=zh_female_vv_uranus_bigtts
```

TTS 配置只写在项目根目录 `.env`，不要使用 `VITE_*` 前缀。未配置语音密钥时，文字问数、图表和数据分析仍可正常使用，点击朗读会提示语音服务尚未配置。

如果 Embedding 模型尚未下载：

```powershell
uv run hf download BAAI/bge-large-zh-v1.5 --local-dir docker/embedding/bge-large-zh-v1.5
```

## 3. 日常启动

所有命令都从项目根目录执行。

### 3.1 启动 Docker 基础服务

先确认 Docker Desktop 已经完成启动，再执行：

```powershell
docker compose -f docker/docker-compose.yaml up -d
docker compose -f docker/docker-compose.yaml ps
```

正常情况下应看到 MySQL、Elasticsearch、Kibana、Qdrant 和 Embedding 五个服务处于运行状态。

### 3.2 启动后端

```powershell
$env:NO_PROXY = "localhost,127.0.0.1"
$env:PYTHONUTF8 = "1"
uv run fastapi dev main.py
```

接口文档：<http://127.0.0.1:8000/docs>

如果 Windows 控制台编码导致 `fastapi dev` 退出，可以直接运行：

```powershell
$env:NO_PROXY = "localhost,127.0.0.1"
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000
```

### 3.3 启动前端

另开一个终端：

```powershell
cd frontend
pnpm dev
```

访问：<http://127.0.0.1:5173/>

## 4. 启动后快速验证

### 页面验证

1. 使用 `admin / admin123` 登录。
2. 在问数模式输入“统计华北地区的销售总额”。
3. 确认能够看到 SSE 节点进度、结果表格和图表。
4. 当前初始化数据中，华北销售总额应为 `41099.5`。
5. 在问数结果的“数据洞察”下点击“朗读结论”，确认只播放结论、不朗读流程和 SQL。
6. 切换到数据分析模式，确认能够新建项目并生成分析计划。

### 接口验证

```powershell
$sessionId = [guid]::NewGuid().ToString()
$login = curl.exe -s -X POST http://127.0.0.1:8000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | ConvertFrom-Json
$body = '{"query":"统计华北地区的销售总额","session_id":"' + $sessionId + '"}'
curl.exe -N -X POST http://127.0.0.1:8000/api/query -H "Content-Type: application/json" -H ("Authorization: Bearer " + $login.access_token) -d $body
```

正常响应会依次输出 `progress` 事件，并以 `result`、`assistant_message` 或 `error` 作为业务终态。

## 5. 停止与重启

前端和后端在各自终端按 `Ctrl+C` 停止。

停止 Docker 基础服务并保留数据：

```powershell
docker compose -f docker/docker-compose.yaml down
```

重新启动基础服务：

```powershell
docker compose -f docker/docker-compose.yaml up -d
```

除非明确需要重新初始化环境，否则不要执行 `down -v`。该操作会删除 Docker 数据卷中的 MySQL、Elasticsearch 和 Qdrant 数据。

## 6. 元数据知识库维护

只有数仓表结构、字段、指标配置或字段取值索引发生变化时，才需要重建元数据知识库。

构建命令：

```powershell
$env:NO_PROXY = "localhost,127.0.0.1"
uv run python -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml
```

初始化脚本不能直接重复导入。需要完全重建时，应先备份数据，再按维护方案清理旧的 `meta` 数据库、Qdrant 集合和 Elasticsearch 索引。

## 7. 测试命令

后端测试：

```powershell
$env:PYTHONUTF8 = "1"
uv run python -m unittest discover -s tests -v
```

前端构建：

```powershell
cd frontend
pnpm build
```

问数接口评测：

```powershell
uv run python -m app.scripts.evaluate_query_api --base-url http://127.0.0.1:8000
```

## 8. 常见故障

### 前端地址无法打开

- 检查 `5173` 端口是否有进程监听。
- 确认前端终端中的 `pnpm dev` 没有退出。
- 重新启动前端后刷新页面。

### 后端接口无法打开

- 检查 `8000` 端口是否被旧进程占用。
- 查看 `logs/` 中的后端错误日志。
- Windows 出现控制台乱码或编码异常时设置 `PYTHONUTF8=1`，并使用 Uvicorn 启动方式。

### 请求返回 401

- 登录令牌可能已过期、被篡改或来自旧的签名配置。
- 退出后重新登录。
- 不要手工复制旧浏览器中的令牌到新环境。

### 后端访问 Docker 服务失败

- 确认 Docker Desktop 正常运行。
- 检查 `3307`、`9200`、`6333` 和 `8086` 端口。
- 确保后端进程包含 `NO_PROXY=localhost,127.0.0.1`，避免本机代理拦截内部请求。

### 问数长时间停在检索或生成阶段

- 检查大模型 API 是否可访问、额度是否正常。
- 检查 Embedding、Qdrant 和 Elasticsearch 是否健康。
- 查看后端日志中的最后一个节点及 `request_id`。
- 隐藏前端流程图只改变展示方式，不会改变后端检索耗时。

### 按地区查询出现两条“华东”

当前初始化数据中存在两个名称相同的“华东”地区记录。这是地区主数据问题，不是页面重复渲染。修复前不要自行合并后宣称为唯一正确口径。

### Embedding 日志提示 ONNX 不存在

TEI 可以回退到 Candle 后端。只要 `http://127.0.0.1:8086/health` 返回成功，该提示不影响使用。

## 9. 运行数据

| 路径 | 内容 |
| --- | --- |
| `data/langgraph-checkpoints.sqlite` | 多轮问数检查点 |
| `data/shopkeeper-state.sqlite` | 查询审计、会话和分析项目 |
| `logs/` | 应用运行日志 |

删除、迁移或覆盖这些文件前，应先停止后端并做好备份。
