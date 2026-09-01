# 快速启动指南（Windows）

使用Zcode启动更方便
本项目 = Python 后端（FastAPI + LangGraph）+ React 前端 + 5 个 Docker 基础服务（MySQL / Elasticsearch / Kibana / Qdrant / Embedding）。

## 一、环境要求（本机已装好）

| 工具           | 用途                       | 验证命令           |
| -------------- | -------------------------- | ------------------ |
| Docker Desktop | 运行 5 个基础服务          | `docker --version` |
| uv             | Python 3.14 + 后端依赖管理 | `uv --version`     |
| Node.js ≥ 20   | 前端运行环境               | `node --version`   |
| pnpm           | 前端包管理                 | `pnpm --version`   |

> 首次安装/换电脑时才需要做的：
>
> 1. `uv sync` 安装后端依赖
> 2. `pnpm install`（frontend 目录下，建议加 `--registry=https://registry.npmmirror.com`）
> 3. 下载 Embedding 模型：`uv run hf download BAAI/bge-large-zh-v1.5 --local-dir docker/embedding/bge-large-zh-v1.5`
> 4. 复制 `.env.example` 为 `.env`，填入真实的大模型 API Key（当前配置指向 DeepSeek）

## 二、日常启动流程（每次开机后）

打开 **3 个终端**，按顺序执行（都在项目根目录 `shoper-agent-main` 下）。

### 第 1 步：启动 Docker 基础服务（终端 1）

先启动 Docker Desktop（开始菜单打开，或双击安装目录里的 `Docker Desktop.exe`），
等右下角图标变绿后执行：

```powershell
docker compose -f docker/docker-compose.yaml up -d
```

首次启动 MySQL 会自动导入数仓 SQL，等待约 1 分钟。验证：

```powershell
docker compose -f docker/docker-compose.yaml ps
# 5 个容器（mysql / elasticsearch / kibana / qdrant / embedding）都是 Up 即可
```

### 第 2 步：启动后端（终端 2）

```powershell
$env:NO_PROXY = "localhost,127.0.0.1"
uv run fastapi dev main.py
```

看到 `Application startup complete` 即成功。接口文档：http://127.0.0.1:8000/docs

> ⚠️ `NO_PROXY` 必须设置：本机开着系统代理（127.0.0.1:7897）时，
> 不设置它后端连 localhost 的 MySQL/Qdrant/ES 会被代理拦截报 502。
> （新装的系统环境变量已包含此项，重开终端后可省略第一行；在 PowerShell 里执行 `echo $env:NO_PROXY` 验证）

### 第 3 步：启动前端（终端 3）

```powershell
cd frontend
pnpm dev
```

看到 `Local: http://localhost:5173/` 即成功，浏览器打开 **http://localhost:5173** 使用。

## 三、验证项目真的能跑通

任选一种：

- 浏览器打开 http://localhost:5173 ，输入问题「统计华北地区的销售总额」，能看到流式的执行过程和结果表格。
- 或用命令行测试后端（PowerShell）。注意：新版本接口必须传 `session_id`（UUID 格式，同一会话多轮对话用同一个值）：

```powershell
$sessionId = [guid]::NewGuid().ToString()
$body = '{"query":"统计华北地区的销售总额","session_id":"' + $sessionId + '"}'
curl.exe -N -X POST http://127.0.0.1:8000/api/query -H "Content-Type: application/json" -d $body
```

正常会依次输出 progress 消息（识别意图 → 抽取关键词 → 召回 → 生成SQL → 校验 → 执行），
最后一条 `type: result` 里带查询结果（正确结果应为 销售总额 41099.5）。
多轮对话时传同一个 session_id，后续可以直接问「那华东地区呢？」这类指代性问题（服务端会用大模型改写补全）。

## 三点五、运行单元测试

```powershell
uv run python -m unittest tests.test_memory -v
```

（必须在项目根目录执行；直接 `python tests/test_memory.py` 会报找不到 app 模块）

## 四、停止 / 重启

```powershell
# 停止后端、前端：在对应终端按 Ctrl+C

# 停止 Docker 服务（保留数据）
docker compose -f docker/docker-compose.yaml down

# 彻底清空 MySQL/ES/Qdrant 数据重新来（慎用）
docker compose -f docker/docker-compose.yaml down -v
```

## 五、重新构建元数据知识库

只有数仓结构变更后才需要。注意：脚本**不能重复执行**（MySQL 主键冲突），重跑前先重置 meta 库：

```powershell
docker exec -i mysql mysql -uroot -pdili123 -e "DROP DATABASE meta;"
docker exec -i mysql mysql -uroot -pdili123 --default-character-set=utf8mb4 < docker/mysql/meta.sql
$env:NO_PROXY = "localhost,127.0.0.1"
uv run python -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml
```

## 六、常见问题

| 现象                             | 原因与解决                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后端报 Qdrant/ES 502 或连接失败  | 系统代理拦截了 localhost，设置 `NO_PROXY=localhost,127.0.0.1` 后重启后端                                                                                                                           |
| Docker 拉镜像卡住/超时           | Docker Hub 被墙。镜像加速已配置在 `~/.docker/daemon.json`；ES 基础镜像需从官方源拉：`docker pull docker.elastic.co/elasticsearch/elasticsearch:8.19.10` 后 `docker tag` 为 `elasticsearch:8.19.10` |
| 构建知识库报 Duplicate entry     | 重复执行了构建脚本，按上面「五」重置 meta 库后重跑                                                                                                                                                 |
| pnpm install 极慢                | 加 `--registry=https://registry.npmmirror.com`                                                                                                                                                     |
| embedding 容器日志报 onnx 不存在 | 可忽略，TEI 会自动回退到 candle 后端，`/health` 返回 200 即正常                                                                                                                                    |
| 端口 3307/8086/9200/6333 被占用  | 这些是容器映射端口，检查占用进程或改 docker-compose.yaml 与 conf/app_config.yaml（两处要一致）                                                                                                     |

## 七、端口与配置速查

| 服务            | 本机端口 | 配置位置                                          |
| --------------- | -------- | ------------------------------------------------- |
| 前端            | 5173     | frontend/vite.config.ts                           |
| 后端            | 8000     | 启动命令参数                                      |
| MySQL           | 3307     | conf/app_config.yaml + docker/docker-compose.yaml |
| Elasticsearch   | 9200     | 同上                                              |
| Qdrant          | 6333     | 同上                                              |
| Embedding (TEI) | 8086     | 同上                                              |
| Kibana          | 5601     | 同上                                              |

大模型配置在 `conf/app_config.yaml` 的 `llm` 段（模型名 / base_url 可换成任意 OpenAI 兼容平台），API Key 从项目根目录 `.env` 的 `LLM_API_KEY` 读取。
