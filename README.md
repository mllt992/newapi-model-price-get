# AI 模型价格同步站

一个用于同步和展示多个 AI 模型平台定价信息的工具，支持 SiliconFlow 和 models.dev 两大平台。

## 功能特性

- 自动同步 SiliconFlow 和 models.dev 平台的模型定价
- 支持美元/人民币价格切换显示
- 实时搜索、筛选、排序功能
- 分页浏览大量模型数据
- 同步历史记录
- 统一的 API 接口，方便其他系统集成

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置 API 密钥（可选）

SiliconFlow 同步功能需要一个 API Key。

1. 访问 [SiliconFlow](https://siliconflow.cn) 注册账号
2. 获取 API Key
3. 设置环境变量：

```bash
# Linux/Mac
export SILICONFLOW_API_KEY="your-api-key-here"

# Windows CMD
set SILICONFLOW_API_KEY=your-api-key-here

# Windows PowerShell
$env:SILICONFLOW_API_KEY="your-api-key-here"
```

或者创建 `.env` 文件（已在 .gitignore 中，不会泄露）：

```
SILICONFLOW_API_KEY=your-api-key-here
```

> 注意：项目内置了默认 API Key，如需稳定使用建议配置自己的密钥。

### 运行

```bash
npm run dev
```

服务启动后访问：
- 模型列表：http://localhost:3000/
- 同步管理：http://localhost:3000/sync

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/models | 获取模型列表（支持分页、搜索、排序） |
| GET | /api/platforms | 获取平台统计 |
| GET | /api/stats | 获取统计数据 |
| POST | /api/sync | 触发同步 |
| GET | /api/sync/history | 获取同步历史 |
| GET | /api/ratio_config | 获取兼容格式的费率数据 |

### 模型列表参数

```
GET /api/models?page=1&limit=50&platform=siliconflow&search=gpt&sort=price_prompt&order=desc
```

- `page`: 页码（默认 1）
- `limit`: 每页数量（默认 50）
- `platform`: 平台筛选（siliconflow / modelsdev）
- `search`: 搜索关键词
- `sort`: 排序字段（model_name / price_prompt / updated_at）
- `order`: 排序方向（asc / desc）

## 技术栈

- Node.js + Express
- SQLite（数据存储）
- 原生 HTML/CSS/JS（无框架依赖）

## 数据说明

- 数据库文件位于 `data/prices.db`
- SiliconFlow 数据以人民币（CNY）计价
- models.dev 数据以美元（USD）计价
- 前端支持自动汇率转换显示
