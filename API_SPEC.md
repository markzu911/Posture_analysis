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

### D. 图片上传/图片列表接口 (`/api/upload/image`)
*   **用途**: 统一处理图片上传、图片列表查询和删除；同一套数据同时驱动用户端“我的图片”和管理员端“图片管理”。
*   **大图/无损推荐**: 不要把图片转成 base64 JSON 传给主站或工具代理。优先使用 `POST /api/upload/direct-token` 获取 OSS 直传地址，然后浏览器或 Vercel 工具端直接 `PUT` 原始 `File/Blob` 到 OSS。

#### 1) 上传图片 (`POST /api/upload/image`)
*   **调用时机**: 工具生成图片后回写 OSS。
*   **AI Studio + Vercel 工具说明**:
    * 工具端可以先把用户上传的参考图发给 Gemini，但这类输入图不应该写入主站图片库。
    * Gemini 返回结果图后，只有完成 `/api/tool/consume` 扣费的结果图才能写入图片记录；无损直传可以先把结果图 `PUT` 到 OSS，再执行 `consume + commit`。
    * 当工具通过主站 `/ai-tool/{toolId}/...` 代理访问时，主站会在扣费后短时间内识别工具端的 `/api/upload/image` 请求，并把该次上传作为结果图保存。
*   **图片类型**:
    * `source = "result"`：AI 生成后的结果图，上传 OSS 并写入 `UserImage`，会显示在“我的图片”和“图片管理”。不传时默认为 `result`，兼容旧工具。
    * `source = "input"`：仅用于平台内置工作流临时换取公网 URL，不写入 `UserImage`；第三方工具代理下的用户原图上传不接入主站保存。
*   **请求体**: `{ "base64": "data:image/png;base64,...", "userId": "string", "source": "result" }`
*   **多图字段**: JSON 可传 `base64s`、`images`、`imageUrls`、`urls` 数组；`multipart/form-data` 可传多个 `files`、`file`、`images`、`image`。
*   **适用场景**: 小图、旧工具兼容、或结果图已经有公网/临时 URL 时使用。无损大图不要使用 base64 字段。
*   **处理逻辑**:
    1. 解析 base64、远程 URL 或 multipart 图片。
    2. 生成 OSS 文件名。
    3. 上传到阿里云 OSS。
    4. 当 `source = "result"` 时写入 `UserImage` 表。
*   **成功响应**:
    ```json
    {
      "success": true,
      "source": "result",
      "savedToRecords": true,
      "url": "https://bucket.oss-cn-shanghai.aliyuncs.com/xxx.png",
      "fileName": "13800138000_1713139200000_abc123.png",
      "images": [
        {
          "url": "https://bucket.oss-cn-shanghai.aliyuncs.com/xxx.png",
          "fileName": "13800138000_1713139200000_abc123.png"
        }
      ]
    }
    ```

#### 2) 大图直传签名 (`POST /api/upload/direct-token`)
*   **用途**: 为无损大图生成 OSS 直传地址，图片文件本体不经过主站代理和 Vercel Function body。
*   **请求体**:
    ```json
    {
      "userId": "string",
      "source": "input",
      "fileName": "room.png",
      "mimeType": "image/png",
      "fileSize": 8388608
    }
    ```
*   **source 说明**:
    * `input`：用户上传给 Gemini 的参考图，不写入“我的图片”。
    * `result`：Gemini 生成后的结果图，只是先直传到 OSS；真正写入图片记录要再调用 `/api/upload/commit`。
*   **成功响应**:
    ```json
    {
      "success": true,
      "method": "PUT",
      "objectKey": "input/13800138000_1713139200000_abc123.png",
      "uploadUrl": "https://bucket.oss-cn-shanghai.aliyuncs.com/...",
      "url": "https://signed-read-url...",
      "headers": {
        "Content-Type": "image/png"
      }
    }
    ```
*   **工具端上传示例**:
    ```javascript
    const token = await fetch('/api/upload/direct-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        source: 'input',
        fileName: file.name,
        mimeType: file.type || 'image/png',
        fileSize: file.size
      })
    }).then((res) => res.json());

    await fetch(token.uploadUrl, {
      method: token.method,
      headers: token.headers,
      body: file
    });

    // 传给 Gemini 使用 token.url 或 objectKey，不要再传 base64。
    ```
*   **前置要求**: OSS Bucket 必须配置 CORS，允许工具域名或 `*` 使用 `PUT, GET, HEAD, OPTIONS`，并允许 `Content-Type` 请求头。

#### 3) 直传结果图入库 (`POST /api/upload/commit`)
*   **用途**: 结果图已通过 `/api/upload/direct-token` 直传到 OSS 后，把该 OSS object 写入 `UserImage`，让它出现在“我的图片”和“图片管理”。
*   **调用时机**: Gemini 生成成功、结果图已直传 OSS、并且 `/api/tool/consume` 扣费成功之后。通过 `/ai-tool/{toolId}/...` 代理访问时，主站会校验短时扣费标记。
*   **请求体**:
    ```json
    {
      "userId": "string",
      "source": "result",
      "objectKey": "result/13800138000_1713139200000_abc123.png",
      "fileSize": 8388608
    }
    ```
*   **成功响应**:
    ```json
    {
      "success": true,
      "source": "result",
      "savedToRecords": true,
      "url": "https://signed-read-url...",
      "fileName": "result/13800138000_1713139200000_abc123.png"
    }
    ```
*   **无损结果图推荐流程**:
    1. 用户原图：`direct-token(source=input)` → OSS `PUT` → 把返回的 `url` 传给 Gemini。
    2. Gemini 成功返回结果图 Blob/File。
    3. 结果图：`direct-token(source=result)` → OSS `PUT`。
    4. 调用 `/api/tool/consume` 扣费。
    5. 调用 `/api/upload/commit` 写入图片记录。

#### 4) 查询图片列表 (`GET /api/upload/image`)
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
          "fileName": "13800138000_1713139200000.png",
          "fileSize": 3072000,
          "createdAt": "2026-04-15T10:12:38.000Z"
        }
      ],
      "total": 1
    }
    ```

#### 5) 删除图片 (`DELETE /api/upload/image`)
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
5.  **扣费后保存结果图**: `/api/tool/consume` 成功后，主站会给当前 `userId + toolId` 写入一个短时结果图待保存标记；随后工具端上传的结果图才进入主站 OSS 和图片列表。

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

// 安全生成接口 (最佳实践)
app.post("/api/generate", async (req, res) => {
  const { userId, toolId, imageBase64, mimeType, stylePrompt } = req.body;

  // 1. 验证 (后端调用 http://aibigtree.com/api/tool/verify)
  // 2. 生成 (后端调用 AI 服务)
  // 3. 扣费 (后端调用 http://aibigtree.com/api/tool/consume)
  // 4. 返回结果
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
