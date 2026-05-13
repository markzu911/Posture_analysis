# SaaS 接口对接与积分校验规范 (V4-3Step)

本文档定义了前端工具与 SaaS 后端（积分/权限系统）对接的标准规范，采用三步走流程确保积分校验与扣除的准确性。

## 0. 当前适用场景：AI Studio + Vercel + Gemini

当前图片类工具的推荐部署方式是：

1. **工具 UI/业务代码**：由 AI Studio 生成，部署到工具自己的 Vercel 项目。
2. **AI 生成能力**：在 Vercel 工具端调用 Gemini 模型；Gemini API Key、模型名、提示词和生成逻辑属于工具端实现，不写入 SaaS 主站。
3. **SaaS 主站职责**：只负责工具入口、用户身份、积分校验、积分扣除、工具代理和结果图保存。
4. **图片入库规则**：用户上传给 Gemini 的参考图不进入主站“我的图片”；Gemini 生成成功并完成扣费后的结果图，才保存到 OSS 和 `UserImage` 表。

因此，新工具对接时不要把 Gemini 接口直接暴露给主站前端，也不要让主站代替工具端组织 Gemini 请求。主站只需要知道 `userId`、`toolId`、扣费结果，以及最终要保存的结果图片。

## 1. 接口调用流程 (3-Step Flow)

工具运行过程中会分三次调用后端接口：

1.  **启动阶段 (`/api/tool/launch`)**: 页面加载时调用，获取用户和工具的基础信息及初始积分。
2.  **校验阶段 (`/api/tool/verify`)**: 用户点击"生成"按钮时调用，仅校验积分是否充足，**不执行扣分**。
3.  **生成阶段（工具端/Vercel）**: 工具端调用 Gemini 执行真实生成，生成失败时不扣费。
4.  **扣费阶段 (`/api/tool/consume`)**: AI 内容生成成功后调用，执行实际的**积分扣除**操作。

对于图片类工具，生成成功后还会进入图片持久化流程：后端把图片保存到 OSS，并写入 `UserImage` 表，用户端“我的图片”和管理员端“图片管理”都从这里读取。

---

## 2. 接口详情规范

### A. 启动接口 (`/api/tool/launch`)
*   **调用时机**: 页面初始化。
*   **请求体**: `{ "userId": "string", "toolId": "string" }`
*   **成功响应**:
    ```json
    {
      "success": true,
      "data": {
        "user": { "name": "张三", "enterprise": "某某公司", "integral": 100 },
        "tool": { "name": "AI 写作助手", "integral": 10 }
      }
    }
    ```

### B. 校验接口 (`/api/tool/verify`)
*   **调用时机**: 点击"生成"按钮，AI 开始工作前。
*   **请求体**: `{ "userId": "string", "toolId": "string" }`
*   **成功响应 (积分充足)**:
    ```json
    {
      "success": true,
      "data": { "currentIntegral": 100, "requiredIntegral": 10 }
    }
    ```
*   **失败响应 (积分不足)**:
    ```json
    {
      "success": false,
      "message": "积分不足，还差 5 积分"
    }
    ```

### C. 扣费接口 (`/api/tool/consume`)
*   **调用时机**: AI 成功返回文案后。
*   **请求体**: `{ "userId": "string", "toolId": "string" }`
*   **成功响应**:
    ```json
    {
      "success": true,
      "data": { "currentIntegral": 90, "consumedIntegral": 10 }
    }
    ```

### D. 结果图保存与图片列表接口
*   **统一规范**: 主站 OSS 只保存工具生成的结果图。用户上传的原图/参考图不要上传到主站 OSS，也不会写入“我的图片”。
*   **原因**: 用户原图只属于本次生成过程，避免占用 OSS、污染图片记录和带来隐私/生命周期问题；结果图才是用户需要复用、下载、管理的资产。
*   **唯一标准接口**: 旧工具重构和新工具开发都统一调用 `POST /api/upload/save-result`。不要再让工具直接调用 `/api/upload/direct-token`、`/api/upload/commit` 或 `/api/upload/image`。
*   **最稳妥输入**: 优先提交“可远程访问的结果图 URL”，由 SaaS 主站后端下载、上传 OSS、写入 `UserImage`。只要这个请求已经到达主站，用户关闭工具页面也不会中断后端保存。
*   **Blob/File 兼容输入**: 如果结果图只存在于浏览器 Blob/File/base64，也仍然提交到同一个 `/api/upload/save-result`，不要换接口。

#### 1) 统一保存结果图 (`POST /api/upload/save-result`)
*   **用途**: 工具提交生成后的结果图，SaaS 主站后端负责上传 OSS、写入 `UserImage`，让图片出现在用户端“我的图片”和管理员端“图片管理”。
*   **调用时机**: Gemini/AI 成功生成结果图，并且 `/api/tool/consume` 扣费成功之后。
*   **方式 A：URL JSON（最推荐）**
    ```json
    {
      "userId": "string",
      "toolId": "string",
      "source": "result",
      "imageUrls": ["https://your-tool.vercel.app/result/xxx.png"],
      "idempotencyKey": "generation-request-id"
    }
    ```
*   **方式 B：base64 JSON（结果图只有内存数据时使用）**
    ```json
    {
      "userId": "string",
      "toolId": "string",
      "source": "result",
      "base64s": ["data:image/png;base64,..."],
      "idempotencyKey": "generation-request-id"
    }
    ```
*   **方式 C：multipart File/Blob（结果图是 Blob/File 时使用）**
    ```javascript
    const formData = new FormData();
    formData.append('userId', userId);
    formData.append('toolId', toolId);
    formData.append('source', 'result');
    formData.append('idempotencyKey', requestId);
    resultFiles.forEach((file) => formData.append('files', file));

    const saved = await fetch('/api/upload/save-result', {
      method: 'POST',
      body: formData
    }).then((res) => res.json());
    ```
*   **字段说明**:
    * `source` 必须是 `result`；`input` 会被拒绝。
    * `imageUrl`、`image_url`、`imageUrls`、`image_urls`、`url`、`urls` 都可识别，推荐统一用 `imageUrls`。
    * `base64`、`base64s`、`images`、`imageData`、`imageDatas` 可用于 base64 JSON。
    * multipart 文件字段支持 `files`、`file`、`images`、`image`、`blob`、`result`、`results`。
    * `idempotencyKey` 推荐传本次生成请求 ID。网络重试时使用同一个值，主站会尽量复用同一条图片记录，避免重复入库。
    * 结果图 URL 必须是公网可访问的 `http/https` 图片地址；`localhost`、内网 IP、`.local` 地址会被拒绝，避免隐私和 SSRF 风险。
    * 支持 `jpeg/jpg/png/webp/gif`，单张结果图最大 50MB。
*   **成功响应**:
    ```json
    {
      "success": true,
      "source": "result",
      "savedToRecords": true,
      "recordId": "img_xxx",
      "url": "https://signed-read-url...",
      "fileName": "result/sha256-or-random.png",
      "image": {
        "recordId": "img_xxx",
        "url": "https://signed-read-url...",
        "fileName": "result/sha256-or-random.png",
        "fileSize": 8388608,
        "savedToRecords": true
      },
      "images": []
    }
    ```
*   **最稳妥流程**:
    1. 用户原图：只在工具前端/工具后端临时传给 Gemini，不调用主站上传接口，不进主站 OSS。
    2. AI 成功生成结果图，优先拿公网可访问的结果图 URL；没有 URL 时使用 base64 或 multipart File。
    3. 调用 `/api/tool/consume` 扣费，主站写入 10 分钟“结果图待保存”标记。
    4. 立即调用 `/api/upload/save-result`，传 `source: "result"`、结果图数据和 `idempotencyKey`。
    5. 确认返回 `savedToRecords === true` 和 `recordId` 后，图片记录已经写入 `UserImage`。
*   **多图要求**:
    * 多张结果图一次性放进同一个请求提交：URL 用 `imageUrls` 数组，base64 用 `base64s` 数组，multipart 多次 append `files`。
    * `idempotencyKey` 表示同一次生成任务；数组顺序必须稳定，重试时不要改变顺序。
    * 主站会按数组逐张保存，返回的 `images` 与提交顺序一致。
*   **关闭页面说明**:
    * 请求到达主站之后，主站后端会继续完成下载、上传 OSS、写入记录。
    * 如果结果图只在浏览器内存里，还没有把 URL 或图片文件发送给主站，用户关闭页面仍然会丢失；这种情况没有后端可以补救。

#### 2) 查询图片列表 (`GET /api/upload/image`)
*   **调用时机**: 用户端“我的图片”或管理员端“图片管理”页面刷新时。
*   **查询参数**: `userId`, `role`
*   **保留策略**: 只展示并保留最近 30 天的结果图记录；OSS 桶侧图片生命周期也按 30 天清理。
*   **权限规则**:
    * `role = 2`：返回所有图片记录。
    * 其他角色：仅返回当前用户自己的图片记录。
*   **成功响应**:
    ```json
    {
      "success": true,
      "data": [
        {
          "id": "img_xxx",
          "userId": "user_xxx",
          "userName": "谢岐山1",
          "url": "https://signed-url...",
          "fileName": "1713139200000_7f3a9c2e1b4d4f6aa8c9d0e1f2a3b4c5.png",
          "fileSize": 3072000,
          "createdAt": "2026-04-15T10:12:38.000Z"
        }
      ],
      "total": 1
    }
    ```

#### 3) 删除图片 (`DELETE /api/upload/image`)
*   **请求体**: `{ "id": "string", "userId": "string", "role": 1 }`
*   **处理逻辑**:
    1. 校验权限。
    2. 删除 OSS 文件。
    3. 删除 `UserImage` 表记录。
*   **成功响应**:
    ```json
    {
      "success": true,
      "message": "删除成功"
    }
    ```

#### 4) 平台内部兼容接口
`/api/upload/direct-token`、`/api/upload/commit`、`/api/upload/image` 仅保留给未重构的历史工具和平台内部兼容逻辑。旧工具重构后不要再调用这些接口。

### E. 工作流执行接口 (`/api/coze/workflow`)
*   **用途**: 调用扣子工作流并在成功后自动保存生成图片。
*   **成功响应补充字段**:
    ```json
    {
      "success": true,
      "data": {
        "output": {},
        "savedImageUrl": "https://signed-url..."
      }
    }
    ```
*   **说明**:
    * `savedImageUrl` 是后端保存到 OSS 后返回的可直接展示链接。
    * 保存成功后，图片记录已经写入 `UserImage` 表，用户端和管理员端刷新列表即可看到。

---

## 3. AI Studio 工具部署与代理配置 (Vercel)

AI Studio 工具建议作为独立 Vercel 项目部署。SaaS 主站保存该工具的 Vercel 访问地址，并通过 `/ai-tool/{toolId}/...` 代理工具页面、静态资源和工具端 API 请求。

工具端在 Vercel 内部调用 Gemini；SaaS 主站不需要也不应该保存 Gemini API Key。

代理层用于解决跨域、Iframe 嵌入、同源路径改写，以及在扣费完成后接收结果图上传。

### 核心原则：
1.  **无鉴权转发**: 除非后端要求，否则不添加 `Authorization`。
2.  **全开放访问**: 允许所有来源的 Iframe 嵌入 (`frame-ancestors *`)。
3.  **大容量支持**: 允许较大体积的 JSON 传输。
4.  **模型调用留在工具端**: Gemini 请求、重试、模型参数和提示词拼接都在 AI Studio/Vercel 工具端完成。
5.  **只保存结果图**: 用户上传的原图/参考图不调用主站上传接口，不进入主站 OSS。`/api/tool/consume` 成功后，主站会给当前 `userId + toolId` 写入一个短时结果图待保存标记；随后工具端优先调用 `/api/upload/save-result` 交给主站后端保存结果图。主站只有在保存接口返回 `success: true` 且 `savedToRecords: true` 后才消耗该标记，失败时可以重试。

### 代理代码参考 (`api/proxy.ts`):
```ts
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");

  // 处理 OPTIONS 预检请求，防止 404
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

const proxyRequest = async (req, res, targetPath) => {
  const targetUrl = `http://aibigtree.com${targetPath}`;
  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: { 'Content-Type': 'application/json' }
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(500).json({ error: "代理转发失败" });
  }
};

app.post("/api/tool/launch", (req, res) => proxyRequest(req, res, "/api/tool/launch"));
app.post("/api/tool/verify", (req, res) => proxyRequest(req, res, "/api/tool/verify"));
app.post("/api/tool/consume", (req, res) => proxyRequest(req, res, "/api/tool/consume"));
app.post("/api/upload/save-result", (req, res) => proxyRequest(req, res, "/api/upload/save-result"));

// 安全生成接口 (最佳实践)
app.post("/api/generate", async (req, res) => {
  const { userId, toolId, stylePrompt } = req.body;

  // 1. 验证 (后端调用 http://aibigtree.com/api/tool/verify)
  // 2. 生成 (后端调用 AI 服务)
  // 3. AI 返回可远程访问的结果图 URL
  // 4. 扣费 (后端调用 http://aibigtree.com/api/tool/consume)
  // 5. 调用 http://aibigtree.com/api/upload/save-result 保存结果图记录
  // 6. 返回结果
});

export default app;
```

---

## 4. 参数校验与提示词合成规范 (Validation & Prompt Merging)

前端工具在接收参数时，必须过滤掉无效的占位字符串，防止后端查询失败：

- **过滤逻辑**: 必须检查并排除 `"null"` 或 `"undefined"` 字符串。
- **原因**: 某些平台在参数缺失时会填充这些字符串，导致后端数据库查询不到对应的 ID。

前端工具在生成内容时，内部 AI 指令应动态结合 SaaS 传入的参数：

- **Context (内容主体)**: 作为生成任务的核心背景。
- **Prompt (关键词数组)**: 作为风格或细节的补充约束。
- **合成公式**: `最终提示词 = 内部预设风格 + SaaS 内容主体 + SaaS 补充关键词`。

---

## 5. 无痕传参 (postMessage)

推荐使用 `postMessage` 避免在 URL 中暴露敏感 ID。

### 对接流程 (SaaS 平台侧实现)：

1. **嵌入 Iframe**:
   ```html
   <iframe id="ai-tool" src="https://your-tool-url.com" style="width:100%; height:800px; border:none;"></iframe>
   ```

2. **发送初始化数据 (JavaScript)**:
   ```javascript
   const iframe = document.getElementById('ai-tool');

   // 当 Iframe 加载完成后发送数据
   iframe.onload = () => {
     iframe.contentWindow.postMessage({
       type: 'SAAS_INIT',
       userId: 'user_123',
       toolId: 'tool_abc',
      context: '主体内容',
      prompt: ['关键词1', '关键词2'], // 数组形式
      verifyUrl: 'https://api.yoursaas.com/api/tool/verify',
      consumeUrl: 'https://api.yoursaas.com/api/tool/consume',
      saveResultUrl: 'https://api.yoursaas.com/api/upload/save-result',
      callbackUrl: 'https://api.yoursaas.com/api/tool/consume'
     }, '*');
   };
   ```

### 连续使用扣费规则

用户在同一个工具页面里连续生成时，必须每次生成都执行一次扣费。推荐流程：

1. 每次点击生成前调用 `/api/tool/verify` 校验积分。
2. AI 生成成功后调用 `/api/tool/consume` 扣除本次积分。
3. 如果生成失败或用户取消，不调用 `/api/tool/consume`。

工具侧可以二选一触发扣费：

```javascript
// 方式 A：直接请求扣费接口
await fetch(consumeUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, toolId })
});
```

```javascript
// 方式 B：通知父页面代扣。每次生成成功发送一次。
window.parent.postMessage({
  type: 'SAAS_CONSUME',
  userId,
  toolId,
  requestId: crypto.randomUUID() // 可选，用于避免同一次生成重复消息导致双扣
}, '*');
```

父页面扣费完成后会回传：

```javascript
window.addEventListener('message', (event) => {
  if (event.data.type === 'SAAS_CONSUME_RESULT') {
    console.log(event.data.success, event.data.data || event.data.error);
  }
});
```

> 注意：方式 A 和方式 B 不要同时使用，否则同一次生成会被扣两次。

### 为什么不直接用 POST 请求？
虽然可以通过 `<form method="POST" target="iframe">` 提交，但由于前端是单页应用 (SPA)，浏览器无法直接让 JavaScript 读取 `POST` 的 Body 数据。使用 `postMessage` 可以完美替代 `POST` 的效果，且实现更简单。

---

## 6. 常见问题与复用指南
*   **去掉校验**: 前端已改为"宽松校验"，只要后端返回 `200 OK` 且包含 `success: true` 或 `valid: true` 即可通过。
*   **去掉限制**: 代理层已配置 `Access-Control-Allow-Origin: *` 和 `frame-ancestors *`，支持任何域名嵌入。
*   **复用方法**: 以后新项目只需拷贝 `api/proxy.ts` 和 `vercel.json` 即可快速搭建代理环境。
