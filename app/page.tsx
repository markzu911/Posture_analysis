'use client';

import dynamic from 'next/dynamic';

const PostureAnalyzer = dynamic(() => import('@/components/PostureAnalyzer'), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="min-h-screen bg-[#F9FAFB] selection:bg-blue-500/30">
      <PostureAnalyzer />
    </main>
  );
}
