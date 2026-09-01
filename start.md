# Shopkeeper Agent 启动指南

本文用于启动本项目的本地演示环境，包括 Docker 基础服务、元数据知识库、FastAPI 后端和 React 前端。

## 1. 前置条件

- Python `3.14+`
- `uv`（或已创建项目 `.venv`）
- Docker Desktop
- Node.js 和 pnpm
- DeepSeek 或其他 OpenAI 兼容 LLM 的 API Key

在项目根目录创建 `.env` 文件：

```env
LLM_API_KEY=你的_API_Key
```

> 不要提交 `.env`，也不要把 API Key 写入 `conf/app_config.yaml`。

## 2. 首次启动

### 2.1 安装依赖

后端：

```bash
uv sync
```

前端：

```bash
cd frontend
pnpm install
cd ..
```

### 2.2 启动 Docker 基础服务

```bash
docker compose -f docker/docker-compose.yaml up -d
```

查看服务状态：

```bash
docker compose -f docker/docker-compose.yaml ps
```

本项目默认端口：

| 服务 | 地址/端口 | 作用 |
| --- | --- | --- |
| MySQL | `localhost:3307` | 教学数仓和元数据存储 |
| Qdrant | `localhost:6333` | 字段、指标向量检索 |
| Elasticsearch | `localhost:9200` | 地区、品牌等真实字段值检索 |
| Embedding | `localhost:8086` | 将文本转换为向量 |
| Kibana | `localhost:5601` | Elasticsearch 可视化，可选 |

> `3307` 是为了避免占用本机已被其他项目使用的 `3306`。配置已同步在 `conf/app_config.yaml` 中。

### 2.3 等待 Embedding 模型加载

首次加载 `bge-large-zh-v1.5` 可能需要几分钟，并占用较多内存。可用以下请求检查服务是否已经可用：

```bash
curl -X POST http://127.0.0.1:8086/embed \
  -H 'Content-Type: application/json' \
  -d '{"inputs":"销售额"}'
```

返回一组数字向量即表示加载成功。

### 2.4 构建元数据知识库

首次启动、修改 `conf/meta_config.yaml`，或清空 Docker 数据卷后，需要执行一次：

```bash
uv run python -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml
```

此步骤会：

```text
YAML 元数据配置 + MySQL 数仓表
  → MySQL 元数据库
  → Qdrant 字段/指标向量库
  → Elasticsearch 字段真实取值索引
```

> 目前构建脚本不是幂等的。不要在已有元数据时重复执行；若确需重建，请先确认清理范围，避免删除其他项目数据。

### 2.5 启动后端

在项目根目录执行：

```bash
uv run fastapi dev main.py --host 0.0.0.0 --port 8000
```

访问 API 文档：

```text
http://localhost:8000/docs
```

### 2.6 启动前端

另开一个终端：

```bash
cd frontend
pnpm dev --host 0.0.0.0 --port 5173
```

访问页面：

```text
http://localhost:5173
```

前端开发环境会把 `/api` 自动代理到 `http://127.0.0.1:8000`。

## 3. 日常启动

如果 Docker 数据卷和元数据索引已经存在，通常只需：

```bash
docker compose -f docker/docker-compose.yaml up -d
uv run fastapi dev main.py --host 0.0.0.0 --port 8000
```

再在另一个终端启动：

```bash
cd frontend && pnpm dev --host 0.0.0.0 --port 5173
```

## 4. 停止项目

先在运行前后端的终端按 `Ctrl+C`。

再停止 Docker 服务：

```bash
docker compose -f docker/docker-compose.yaml down
```

此命令会停止并删除容器和网络，但会保留 Docker volumes 中的 MySQL、Qdrant、Elasticsearch 数据。

若本机内存不足，可单独停止不参与问数主链路的 Kibana：

```bash
docker compose -f docker/docker-compose.yaml stop kibana
```

## 5. 常见问题

### 前端显示“接口请求失败”

确认后端已启动：

```bash
curl http://127.0.0.1:8000/docs
```

若返回 HTTP `200`，后端正常；否则检查 FastAPI 终端日志。

### Embedding 服务连接重置或加载缓慢

`bge-large-zh-v1.5` 是本项目中最占内存的组件。建议：

1. 停止 Kibana；
2. 在 Docker Desktop 中分配至少 `6 GB` 内存；
3. 等待模型预热完成后再发送问数请求；
4. 查看日志：

```bash
docker compose -f docker/docker-compose.yaml logs -f embedding
```

### MySQL 端口冲突

本项目使用宿主机端口 `3307`。如果该端口也被占用，修改以下两个位置保持一致：

```text
docker/docker-compose.yaml
conf/app_config.yaml
```

### 修改模型服务

OpenAI 兼容模型配置位于：

```text
conf/app_config.yaml
```

当前 DeepSeek 示例：

```yaml
llm:
  model_name: deepseek-v4-flash
  api_key: ${oc.env:LLM_API_KEY}
  base_url: https://api.deepseek.com
```
