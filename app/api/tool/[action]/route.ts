import { NextResponse } from 'next/server';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> } // In Next.js 15, params is a Promise
) {
  const { action } = await params;
  
  if (!['launch', 'verify', 'consume'].includes(action)) {
    return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 });
  }

  const targetPath = `/api/tool/${action}`;
  const targetUrl = `http://aibigtree.com${targetPath}`;

  try {
    const body = await request.json();
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error(`Error proxying ${action}:`, error);
    return NextResponse.json({ success: false, error: '代理转发失败' }, { status: 500 });
  }
}
