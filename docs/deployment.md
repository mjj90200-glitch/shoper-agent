# 部署指南（P4-C）

本文覆盖从零启动完整系统的两种方式、全部环境变量与备份恢复。日常开发启动见 [start.md](../start.md)。

## 1. 方式一：本机开发/日常使用（前后端本机进程 + Docker 基础设施）

```powershell
docker compose -f docker/docker-compose.yaml up -d      # 5 个基础设施容器
uv sync                                                  # 后端依赖
cd frontend; pnpm install; cd ..                         # 前端依赖
uv run python -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml   # 仅首次/元数据变更后
# 创建数仓只读账号（见 start.md 6.5）
# 后端：uvicorn main:app --host 127.0.0.1 --port 8000
# 前端：cd frontend; pnpm dev
```

## 2. 方式二：一条命令容器化全栈（P4-A）

```powershell
docker compose -f docker/docker-compose.yaml --profile app up -d --build
```

启动后：前端 http://127.0.0.1:8080 （nginx 托管并反代 `/api`），后端 http://127.0.0.1:8000/docs。
只启动基础设施（默认行为，不含应用）：

```powershell
docker compose -f docker/docker-compose.yaml up -d
```

## 3. 环境变量清单

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `LLM_API_KEY` | ✅ 启动必需 | — | 大模型 API Key（OpenAI 兼容） |
| `MYSQL_ROOT_PASSWORD` | ✅ | — | MySQL root（Compose 初始化用） |
| `MYSQL_USER` / `MYSQL_PASSWORD` | ✅ 启动必需 | — | 元数据库账号 |
| `MYSQL_HOST` / `MYSQL_PORT` | — | localhost / 3307 | 容器内分别为 `mysql` / `3306` |
| `DW_USER` / `DW_PASSWORD` | — | 回退 MYSQL_* | 数仓只读账号（P2-B） |
| `QDRANT_HOST` / `EMBEDDING_HOST` / `ES_HOST` | — | localhost | 容器内为服务名 |
| `EMBEDDING_PORT` / `ES_PORT` | — | 8086 / 9200 | 容器内 embedding 为 `80` |
| `APP_ENV` | — | dev | `dev` / `test` / `prod` |
| `VOLCENGINE_TTS_API_KEY` | — | 未配置则禁用语音 | 火山引擎 TTS，仅后端读取 |

缺失 `LLM_API_KEY`、`MYSQL_USER`、`MYSQL_PASSWORD` 时应用启动即失败，错误只列出变量名。

## 4. 备份与恢复

| 数据 | 位置 | 备份 | 恢复 |
| --- | --- | --- | --- |
| 应用状态（审计/会话/分析项目） | `data/shopkeeper-state.sqlite` | 停后端后复制文件 | 覆盖文件后启动，迁移自动补齐 |
| LangGraph 检查点 | `data/langgraph-checkpoints.sqlite` | 同上 | 同上 |
| 数仓与元数据 | Docker 卷 `docker_mysql_data` | `docker exec mysql mysqldump -uroot -p$env:MYSQL_ROOT_PASSWORD --databases dw meta > backup.sql` | `docker exec -i mysql mysql -uroot -p... < backup.sql` |
| 向量与全文索引 | `docker_qdrant_data` / `docker_es_data` 卷 | 停容器后复制卷目录 | 重建元数据知识库或还原卷 |
| 运行日志 | `logs/` | 普通文件复制 | — |

## 5. 演示环境说明

P4-B 计划的"无检索基础设施演示模式"未单独实现：容器化全栈（方式二）本身即一条命令的演示路径，
在低性能设备上可通过限制 Kibana/ES 内存进一步降载。若后续需要脱离 MySQL/Qdrant 的纯静态演示，
应按工程计划重新立项，而不是伪装降级结果。
