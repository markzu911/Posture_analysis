import { NextResponse } from 'next/server';

const SAAS_ORIGIN = 'http://aibigtree.com';

async function readJsonResponse(res: Response) {
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }

  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.message || `请求失败: ${res.status}`);
  }

  return data;
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { userId, toolId, base64 } = body;

        if (!userId || !toolId || !base64) {
            return NextResponse.json({ success: false, error: "Missing required parameters" }, { status: 400 });
        }

        // Decode base64 
        // format usually: "data:image/png;base64,....."
        const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        if (matches && matches.length === 3) {
            mimeType = matches[1];
            imageBuffer = Buffer.from(matches[2], 'base64');
        } else {
            // Assume raw base64
            imageBuffer = Buffer.from(base64, 'base64');
        }
        const fileName = `report-${Date.now()}.png`;

        // 1. Consume points
        const consumeRes = await fetch(`${SAAS_ORIGIN}/api/tool/consume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, toolId })
        });
        const consume = await readJsonResponse(consumeRes);
        if (!consume.success) {
            return NextResponse.json({ success: false, error: consume.error || consume.message || '扣费失败' });
        }

        // 2. Get direct-token
        const tokenRes = await fetch(`${SAAS_ORIGIN}/api/upload/direct-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                toolId,
                source: 'result',
                mimeType,
                fileName,
                fileSize: imageBuffer.byteLength
            })
        });
        const token = await readJsonResponse(tokenRes);

        // 3. Upload to OSS
        const uploadRes = await fetch(token.uploadUrl, {
            method: token.method || 'PUT',
            headers: token.headers,
            body: imageBuffer as unknown as BodyInit
        });
        if (!uploadRes.ok) {
             throw new Error(`OSS 上传失败: ${uploadRes.status}`);
        }

        // 4. Commit
        const commitRes = await fetch(`${SAAS_ORIGIN}/api/upload/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                toolId,
                source: 'result',
                objectKey: token.objectKey,
                fileSize: imageBuffer.byteLength
            })
        });
        const commit = await readJsonResponse(commitRes);
        if (!commit.success || !commit.savedToRecords) {
            throw new Error(commit.error || '图片入库失败');
        }

        return NextResponse.json({
            success: true,
            consumeResult: consume.data,
            image: commit.image
        });

    } catch (error: any) {
        console.error("Save report error:", error);
        return NextResponse.json({ success: false, error: error.message || '保存失败' }, { status: 500 });
    }
}
