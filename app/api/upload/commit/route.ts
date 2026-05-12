import { NextResponse } from 'next/server';

const TARGET_BASE_URL = 'http://aibigtree.com';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function POST(request: Request) {
  const targetUrl = `${TARGET_BASE_URL}/api/upload/commit`;
  
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
    return NextResponse.json(data, { 
      status: response.status,
      headers: getCorsHeaders()
    });
  } catch (error) {
    console.error(`Error proxying upload commit POST:`, error);
    return NextResponse.json({ success: false, error: '代理转发失败' }, { status: 500, headers: getCorsHeaders() });
  }
}
