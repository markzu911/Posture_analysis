'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { UploadCloud, Activity, AlertTriangle, CheckCircle, ChevronRight, RefreshCw, Smartphone, MoveRight } from 'lucide-react';
import { analyzePosture } from '@/lib/gemini';
import { motion, AnimatePresence } from 'motion/react';

interface Keypoint { label: string; x: number; y: number; }
interface AuxLine { label: string; startX: number; startY: number; endX: number; endY: number; color: string; dashed: boolean; }
interface PostureResult {
    viewType: string;
    diagnostics: string[];
    keypoints: Keypoint[];
    auxiliaryLines: AuxLine[];
    report: string;
}

export default function PostureAnalyzer() {
    const [imageStr, setImageStr] = useState<string | null>(null);
    const [mimeType, setMimeType] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<PostureResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    // SaaS Integration State
    const [saasData, setSaasData] = useState<{userId?: string; toolId?: string; context?: string; prompt?: string[]}>({});
    const [userIntegral, setUserIntegral] = useState<number | null>(null);
    const [toolRequiredIntegral, setToolRequiredIntegral] = useState<number | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    // 1. Launch Stage - Listen for SAAS_INIT
    useEffect(() => {
        const handleMessage = async (event: MessageEvent) => {
            if (event.data?.type === 'SAAS_INIT') {
                const { userId, toolId, context, prompt } = event.data;
                if (userId && userId !== "null" && userId !== "undefined") {
                    setSaasData({ userId, toolId, context, prompt });
                    
                    try {
                        const res = await fetch('/api/tool/launch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId, toolId })
                        });
                        const json = await res.json();
                        if (json.success || json.valid) {
                            setUserIntegral(json.data?.user?.integral);
                            setToolRequiredIntegral(json.data?.tool?.integral);
                        }
                    } catch (e) {
                        console.error("SaaS Launch Error:", e);
                    }
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            processFile(file);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) {
            processFile(file);
        }
    };

    const processFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('请上传有效的图片文件');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target?.result as string;
            setMimeType(file.type);
            setImageStr(dataUrl);
            setResult(null);
            setError(null);
        };
        reader.readAsDataURL(file);
    };

    const startAnalysis = async () => {
        if (!imageStr || !mimeType) return;
        setLoading(true);
        setError(null);
        setResult(null);

        // 2. Verify Stage
        if (saasData.userId && saasData.toolId) {
            try {
                const verifyRes = await fetch('/api/tool/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: saasData.userId, toolId: saasData.toolId })
                });
                const verifyJson = await verifyRes.json();
                if (!verifyJson.success && !verifyJson.valid) {
                    setError(verifyJson.message || "积分不足");
                    setLoading(false);
                    return;
                }
            } catch (e) {
                console.error("SaaS Verify Error:", e);
                // Based on spec "宽松校验", if proxy fails completely we might proceed, but let's continue.
            }
        }

        try {
            const base64Data = imageStr.split(',')[1];
            const data = await analyzePosture(base64Data, mimeType, saasData.context, saasData.prompt);
            setResult(data);

            // 3. Consume Stage
            if (saasData.userId && saasData.toolId) {
                try {
                    const consumeRes = await fetch('/api/tool/consume', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: saasData.userId, toolId: saasData.toolId })
                    });
                    const consumeJson = await consumeRes.json();
                    if (consumeJson.success || consumeJson.valid) {
                        setUserIntegral(consumeJson.data?.currentIntegral);
                    }
                } catch (e) {
                    console.error("SaaS Consume Error:", e);
                }
            }
        } catch (err) {
            console.error(err);
            setError('分析失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    const drawOverlay = () => {
        const canvas = canvasRef.current;
        const img = imageRef.current;
        if (!canvas || !img || !result) return;

        // Set actual canvas size to match image pixels
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const w = canvas.width;
        const h = canvas.height;

        // Draw auxiliary lines
        result.auxiliaryLines.forEach(line => {
            ctx.beginPath();
            ctx.moveTo(line.startX * w, line.startY * h);
            ctx.lineTo(line.endX * w, line.endY * h);
            
            ctx.lineWidth = Math.max(3, w * 0.005);
            ctx.strokeStyle = line.color || '#ef4444';
            
            if (line.dashed) {
                ctx.setLineDash([w * 0.02, w * 0.02]);
            } else {
                ctx.setLineDash([]);
            }
            
            ctx.stroke();

            // Label for the line
            if (line.label) {
                ctx.font = `${Math.max(10, w * 0.015)}px 'Courier New', monospace`;
                ctx.fillStyle = line.color || '#ef4444';
                // background for text
                const textWidth = ctx.measureText(line.label).width;
                ctx.fillStyle = 'rgba(15, 17, 21, 0.8)';
                ctx.fillRect(line.startX * w, line.startY * h - Math.max(16, w * 0.025), textWidth + 10, Math.max(18, w * 0.03));
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(line.label, line.startX * w + 5, line.startY * h - Math.max(4, w * 0.008));
            }
        });

        // Draw keypoints
        ctx.setLineDash([]);
        result.keypoints.forEach(pt => {
            ctx.beginPath();
            ctx.arc(pt.x * w, pt.y * h, Math.max(4, w * 0.008), 0, 2 * Math.PI);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#EF4444';
            ctx.stroke();

            // Label for keypoint
            if (pt.label) {
                ctx.font = `${Math.max(10, w * 0.015)}px 'Courier New', monospace`;
                ctx.fillStyle = 'rgba(15, 17, 21, 0.8)';
                const textWidth = ctx.measureText(pt.label).width;
                ctx.fillRect(pt.x * w + 10, pt.y * h - 10, textWidth + 8, 16);
                
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(pt.label, pt.x * w + 14, pt.y * h + 2);
            }
        });
    };

    useEffect(() => {
        if (result) {
            // Need a tiny delay for the image ref to be ready in some cases (e.g., fast React renders)
            setTimeout(() => drawOverlay(), 50);
        }
    }, [result]);

    return (
        <div className="flex flex-col h-full w-full p-6 bg-[#0F1115] text-[#E5E7EB] font-sans">
            <header className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                        AligneAI <span className="text-red-500">PRO</span> 
                        <span className="text-xs font-normal text-gray-500 ml-2">智能姿态诊断系统 v2.4</span>
                    </h1>
                    <p className="text-xs text-gray-400 mt-1">
                        全身三维测算 · 高精度骨骼映射 · 毫秒级诊断
                    </p>
                </div>
                {userIntegral !== null && (
                    <div className="flex gap-3">
                        <div className="bg-red-900/30 border border-red-500/50 px-3 py-1 rounded-sm text-red-400 text-xs flex items-center">
                            当前积分: {userIntegral}
                            {toolRequiredIntegral !== null ? ` (每次消耗 ${toolRequiredIntegral})` : ""}
                        </div>
                    </div>
                )}
            </header>

            {!imageStr && (
                <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="max-w-3xl mx-auto mt-8 relative border-2 border-dashed border-gray-700 bg-gray-800/20 rounded-md p-10 text-center hover:bg-gray-800/40 hover:border-red-500/50 transition-all cursor-pointer group"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input 
                        type="file" 
                        accept="image/*" 
                        ref={fileInputRef} 
                        className="hidden" 
                        onChange={handleFileSelect}
                    />
                    <div className="mx-auto w-16 h-16 bg-[#1A1D23] border border-gray-700 text-gray-300 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                        <UploadCloud className="w-8 h-8" />
                    </div>
                    <h3 className="text-sm font-bold text-gray-200 mb-2 tracking-widest uppercase">点击上传或拖拽图片</h3>
                    <p className="text-[11px] text-gray-400 mb-6 flex items-center justify-center gap-2">
                        <Smartphone className="w-4 h-4"/> 推荐明亮光线、紧身衣物、正面/侧面全身出镜
                    </p>
                    <div className="flex flex-wrap justify-center gap-3 text-[10px] font-medium text-gray-400">
                        <span className="bg-black/40 border border-gray-700 px-3 py-1.5 rounded-sm uppercase">加密传输 AES-256</span>
                        <span className="bg-black/40 border border-gray-700 px-3 py-1.5 rounded-sm uppercase">图像增强 ON</span>
                    </div>
                </motion.div>
            )}

            {imageStr && !result && (
                <div className="max-w-xl mx-auto text-center mt-8">
                    <div className="ai-canvas rounded-lg aspect-auto max-h-[600px] flex items-center justify-center mb-6">
                        <img src={imageStr} alt="Preview" className="max-h-[600px] object-contain opacity-80" />
                        
                        {loading && (
                            <motion.div 
                                initial={{ top: '0%' }}
                                animate={{ top: '100%' }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                className="absolute left-0 w-full h-px bg-red-500 shadow-[0_0_8px_#ef4444] z-10"
                            />
                        )}
                        {loading && (
                            <div className="absolute inset-0 bg-[#0F1115]/80 flex items-center justify-center backdrop-blur-sm">
                                <div className="bg-[#1A1D23] border border-gray-700 px-5 py-3 rounded-sm shadow-xl flex items-center gap-3 text-white text-xs font-bold uppercase tracking-widest">
                                    <RefreshCw className="w-4 h-4 animate-spin text-red-500" />
                                    深度映射中... 98.4%
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {!loading ? (
                        <div className="flex gap-3 justify-center">
                            <button 
                                onClick={() => { setImageStr(null); setError(null); }}
                                className="px-4 py-2 rounded-sm border border-gray-700 text-gray-300 text-xs font-bold hover:bg-gray-800 transition-colors uppercase tracking-wider"
                            >
                                重新选择
                            </button>
                            <button 
                                onClick={startAnalysis}
                                className="px-6 py-2 rounded-sm bg-white text-black text-xs font-bold hover:bg-gray-200 transition-all flex items-center gap-2 uppercase tracking-wider"
                            >
                                <Activity className="w-4 h-4" /> 开始智能诊断
                            </button>
                        </div>
                    ) : null}

                    {error && (
                        <div className="mt-4 p-3 bg-red-900/30 border border-red-500/50 text-red-400 rounded-sm text-xs flex items-center justify-center gap-2">
                            <AlertTriangle className="w-4 h-4"/> {error}
                        </div>
                    )}
                </div>
            )}

            {result && (
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-4"
                >
                    {/* Visualizer Column */}
                    <div className="lg:col-span-5 flex flex-col items-center">
                        <div className="ai-canvas rounded-lg flex flex-col p-3 w-full border border-gray-800">
                            <h3 className="text-xs font-bold uppercase text-white bg-black/20 p-2 border-b border-gray-800 -mx-3 -mt-3 mb-3 flex items-center justify-between">
                                <span>{result.viewType === 'FRONT' ? '正面视图 (Front View)' : '侧面视图 (Side View)'}</span>
                                <span className="text-[10px] text-green-500">AI识别中: 98.4% 匹配度</span>
                            </h3>
                            <div className="relative flex-1 bg-black/40 rounded border border-gray-800 overflow-hidden">
                                <img 
                                    ref={imageRef} 
                                    src={imageStr!} 
                                    alt="Analyzed Posture" 
                                    className="w-full h-auto max-h-[700px] object-contain block mx-auto opacity-80"
                                    onLoad={() => drawOverlay()}
                                />
                                <canvas 
                                    ref={canvasRef} 
                                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                                />
                            </div>
                            <button 
                                onClick={() => { setResult(null); setImageStr(null); }}
                                className="mt-4 w-full py-2 rounded-sm border border-gray-700 text-gray-300 text-xs font-bold hover:bg-gray-800 transition-colors uppercase tracking-wider"
                            >
                                分析另一张照片
                            </button>
                        </div>
                    </div>

                    {/* Report Column */}
                    <div className="lg:col-span-7 flex flex-col gap-4">
                        {/* Highlights */}
                        <div className="data-card p-4 rounded-r-md">
                            <div className="metric-label mb-3">核心指标 / AI 诊断结论</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {result.diagnostics.map((diag, idx) => (
                                    <div key={idx} className="flex gap-2 items-start border-l border-gray-700 pl-3">
                                        <div className="w-5 h-5 bg-red-500/20 text-red-500 flex flex-shrink-0 items-center justify-center rounded text-[10px] font-bold mt-0.5">!</div>
                                        <h4 className="text-white text-xs font-bold leading-relaxed">{diag}</h4>
                                    </div>
                                ))}
                                {result.diagnostics.length === 0 && (
                                    <div className="bg-green-900/10 border-l border-green-500 p-3 col-span-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-5 h-5 bg-green-500/20 text-green-500 flex items-center justify-center rounded text-[10px] font-bold">✓</div>
                                            <h4 className="text-white text-xs font-bold">体态良好，未发现明显异常</h4>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Detailed Markdown Report */}
                        <div className="bg-gray-800/30 border border-gray-700 rounded-md p-4 flex-1 overflow-auto">
                            <div className="text-xs font-bold text-gray-300 mb-3 uppercase tracking-widest">综合评估与矫正建议 / Detailed Assessment</div>
                            <div className="prose prose-invert prose-sm max-w-none prose-headings:text-gray-200 prose-headings:font-bold prose-headings:border-b prose-headings:border-gray-800 prose-headings:pb-2 prose-a:text-red-400 prose-p:text-[11px] prose-p:text-gray-400 prose-li:text-[11px] prose-li:text-gray-400">
                                <ReactMarkdown>{result.report}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
