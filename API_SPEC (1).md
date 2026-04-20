# SaaS 接口对接与积分校验规范 (V4-3Step)

本文档定义了前端工具与 SaaS 后端（积分/权限系统）对接的标准规范，采用三步走流程确保积分校验与扣除的准确性。

## 1. 接口调用流程 (3-Step Flow)

工具运行过程中会分三次调用后端接口：

1.  **启动阶段 (`/api/tool/launch`)**: 页面加载时调用，获取用户和工具的基础信息及初始积分。
2.  **校验阶段 (`/api/tool/verify`)**: 用户点击“生成”按钮时调用，仅校验积分是否充足，**不执行扣分**。
3.  **扣费阶段 (`/api/tool/consume`)**: AI 内容生成成功后调用，执行实际的**积分扣除**操作。

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
*   **调用时机**: 点击“生成”按钮，AI 开始工作前。
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

---

## 3. 代理层配置 (Vercel Proxy)

代理层用于解决跨域并转发请求至 SaaS 后端。

### 核心原则：
1.  **无鉴权转发**: 除非后端要求，否则不添加 `Authorization`。
2.  **全开放访问**: 允许所有来源的 Iframe 嵌入 (`frame-ancestors *`)。
3.  **大容量支持**: 允许较大体积的 JSON 传输。

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

export default app;
```

---

## 4. 参数校验与提示词合成规范 (Prompt Merging)

前端工具在接收参数和生成内容时，需遵循以下逻辑：

- **ID 过滤**: 必须检查并排除 `"null"` 或 `"undefined"` 字符串。
- **提示词合成逻辑**: 工具内部的 AI 指令应动态结合 SaaS 传入的参数：
  - **Context (内容主体)**: 作为生成任务的核心背景。
  - **Prompt (关键词数组)**: 作为风格或细节的补充约束。
  - **合成公式**: `最终提示词 = 内部预设风格 + SaaS 内容主体 + SaaS 补充关键词`。

---

## 5. 无痕传参 (postMessage)

### 发送初始化数据规范:
```javascript
window.postMessage({
  type: 'SAAS_INIT',
  userId: 'user_123',
  toolId: 'tool_abc',
  context: '主体描述内容', // string
  prompt: ['标签1', '标签2'], // array
  callbackUrl: '...' 
}, '*');
```

### 为什么不直接用 POST 请求？
虽然可以通过 `<form method="POST" target="iframe">` 提交，但由于前端是单页应用 (SPA)，浏览器无法直接让 JavaScript 读取 `POST` 的 Body 数据。使用 `postMessage` 可以完美替代 `POST` 的效果，且实现更简单。

---

## 5. 常见问题与复用指南
*   **去掉校验**: 前端已改为“宽松校验”，只要后端返回 `200 OK` 且包含 `success: true` 或 `valid: true` 即可通过。
*   **去掉限制**: 代理层已配置 `Access-Control-Allow-Origin: *` 和 `frame-ancestors *`，支持任何域名嵌入。
*   **复用方法**: 以后新项目只需拷贝 `api/proxy.ts` 和 `vercel.json` 即可快速搭建代理环境。
