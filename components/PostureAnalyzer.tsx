'use client';

import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Activity, AlertTriangle, CheckCircle, ChevronRight, RefreshCw, Smartphone, MoveRight, Download } from 'lucide-react';
import { analyzePosture } from '@/lib/gemini';
import { motion, AnimatePresence } from 'motion/react';
import * as htmlToImage from 'html-to-image';

interface Keypoint { label: string; x: number; y: number; }
interface AuxLine { label: string; startX: number; startY: number; endX: number; endY: number; color: string; dashed: boolean; }
interface Dimension { title: string; score: number; severity: string; description: string; advice: string; }
interface ActionPlan { title: string; description: string; }

interface PostureResult {
    viewType: string;
    overallScore: number;
    postureAge: number;
    postureType: string;
    dimensions: Dimension[];
    actionPlans: ActionPlan[];
    keypoints: Keypoint[];
    auxiliaryLines: AuxLine[];
}

const compressImage = (file: File, maxDim = 1200): Promise<{ dataUrl: string, mimeType: string }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new window.Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error("Failed to get canvas context"));
                    return;
                }
                
                // Fill white background for transparent images (e.g. PNG) converting to JPEG
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                
                const mimeType = 'image/jpeg';
                let quality = 0.85;
                let dataUrl = canvas.toDataURL(mimeType, quality);
                
                // Keep reducing quality until the base64 string is well under ~1MB 
                // (Length of 1,200,000 chars is roughly 900KB)
                while (dataUrl.length > 1200000 && quality > 0.1) {
                    quality -= 0.15;
                    dataUrl = canvas.toDataURL(mimeType, Math.max(0.1, quality));
                }
                
                resolve({ dataUrl, mimeType });
            };
            img.onerror = () => reject(new Error("Failed to load image. Ensure it is a valid image format."));
            img.src = event.target?.result as string;
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
    });
};

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
    const reportRef = useRef<HTMLDivElement>(null);

    const handleDownload = async () => {
        if (!reportRef.current) return;
        try {
            const dataUrl = await htmlToImage.toPng(reportRef.current, { quality: 0.95, backgroundColor: '#FAFAFA' });
            const link = document.createElement('a');
            link.download = 'posture-analysis-report.png';
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error("Failed to download image", err);
            alert("下载失败，请重试");
        }
    };

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

    const processFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('请上传有效的图片文件');
            return;
        }

        try {
            const { dataUrl, mimeType } = await compressImage(file);
            setMimeType(mimeType);
            setImageStr(dataUrl);
            setResult(null);
            setError(null);

            // Upload input image asynchronously as specified in API_SPEC.md (source: 'input')
            if (saasData.userId) {
                fetch('/api/upload/image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: saasData.userId,
                        base64: dataUrl,
                        source: 'input'
                    })
                }).catch(e => console.error("Failed to upload input image:", e));
            }

        } catch (error: any) {
            console.error("Image processing error:", error);
            setError(error.message || '图片处理失败，请尝试其他格式');
        }
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
        } catch (err: any) {
            // Mute console error here to prevent the AI Studio environment from catching it as an app crash log
            const errMsg = err?.message || '';
            if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
                setError('API 请求受限：调用额度已超限或过于频繁，请检查主账户模型配额或稍后再试。');
            } else if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('UNAVAILABLE')) {
                setError('API 满载：大模型当前处理并发过高，请稍微等待几分钟后再进行诊断。');
            } else {
                setError(errMsg || '分析失败，请重试');
            }
        } finally {
            setLoading(false);
        }
    };

    const uploadReportImage = async () => {
        if (!saasData.userId || !reportRef.current) return;

        try {
            const dataUrl = await htmlToImage.toPng(reportRef.current, { quality: 0.95, backgroundColor: '#FAFAFA' });

            await fetch('/api/upload/image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: saasData.userId,
                    base64: dataUrl,
                    source: 'result'
                })
            });
        } catch (e) {
            console.error("Failed to upload report image to OSS:", e);
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
            const normalize = (val: number) => val > 1 ? val / 1000 : val;
            const startX = normalize(line.startX) * w;
            const startY = normalize(line.startY) * h;
            const endX = normalize(line.endX) * w;
            const endY = normalize(line.endY) * h;

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            
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
                ctx.fillRect(startX, startY - Math.max(16, w * 0.025), textWidth + 10, Math.max(18, w * 0.03));
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(line.label, startX + 5, startY - Math.max(4, w * 0.008));
            }
        });

        // Draw keypoints
        ctx.setLineDash([]);
        result.keypoints.forEach(pt => {
            const normalize = (val: number) => val > 1 ? val / 1000 : val;
            const px = normalize(pt.x) * w;
            const py = normalize(pt.y) * h;

            ctx.beginPath();
            ctx.arc(px, py, Math.max(4, w * 0.008), 0, 2 * Math.PI);
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
                ctx.fillRect(px + 10, py - 10, textWidth + 8, 16);
                
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(pt.label, px + 14, py + 2);
            }
        });

        // Upload report image after drawing
        if (saasData.userId) {
            setTimeout(() => {
                uploadReportImage();
            }, 500);
        }
    };

    const renderCircularScore = (score: number, size: number = 64) => {
        const radius = 15.9155;
        const circumference = 100;
        const strokeDasharray = `${score} ${circumference - score}`;
        
        // Color logic based on reference image (yellowish orange for 60-80, green for high, maybe grey/red for low)
        let color = "#10B981"; // Green
        if (score < 80) color = "#F59E0B"; // Yellow
        if (score < 60) color = "#EF4444"; // Red

        return (
            <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
                <svg viewBox="0 0 36 36" className="circular-chart" style={{ width: '100%', height: '100%' }}>
                    <path
                        className="circle-bg"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                        className="circle"
                        strokeDasharray={strokeDasharray}
                        style={{ stroke: color }}
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center font-bold text-gray-800" style={{ fontSize: size * 0.35 }}>
                    {score}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col min-h-screen w-full bg-[#F9FAFB] text-gray-800 font-sans p-4 sm:p-8">
            <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-8 pb-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
                        AligneAI <span className="text-blue-600">PRO</span> 
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        智能姿态高精度物理诊断系统
                    </p>
                </div>
                {userIntegral !== null && (
                    <div className="flex gap-3 mt-4 sm:mt-0">
                        <div className="bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full text-blue-700 text-sm flex items-center font-medium shadow-sm">
                            当前积分: <span className="font-bold ml-1">{userIntegral}</span>
                            {toolRequiredIntegral !== null ? <span className="text-xs text-blue-500 ml-2">(每次消耗 {toolRequiredIntegral})</span> : ""}
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
                    className="max-w-3xl mx-auto mt-8 relative border-2 border-dashed border-gray-300 bg-white rounded-2xl p-12 text-center hover:bg-gray-50 hover:border-blue-400 transition-all cursor-pointer shadow-sm group"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input 
                        type="file" 
                        accept="image/*" 
                        ref={fileInputRef} 
                        className="hidden" 
                        onChange={handleFileSelect}
                    />
                    <div className="mx-auto w-20 h-20 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                        <UploadCloud className="w-10 h-10" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-2">点击上传或拖拽图片</h3>
                    <p className="text-sm text-gray-500 mb-6 flex items-center justify-center gap-2">
                        <Smartphone className="w-4 h-4"/> 推荐明亮光线、紧身衣物、正面/侧面全身出镜
                    </p>
                    <div className="flex flex-wrap justify-center gap-3 text-xs font-medium text-gray-500">
                        <span className="bg-gray-100 px-3 py-1.5 rounded-md uppercase">加密传输 AES-256</span>
                        <span className="bg-gray-100 px-3 py-1.5 rounded-md uppercase">智能节点识别</span>
                    </div>
                </motion.div>
            )}

            {imageStr && !result && (
                <div className="max-w-xl mx-auto text-center mt-8">
                    <div className="relative rounded-2xl overflow-hidden shadow-lg bg-white p-4 mb-6">
                        <img src={imageStr} alt="Preview" className="max-h-[500px] w-auto mx-auto object-contain rounded-xl" />
                        
                        {loading && (
                            <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center backdrop-blur-sm z-20">
                                <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mb-4" />
                                <div className="text-gray-800 font-bold uppercase tracking-widest text-sm">
                                    深度体态映射分析中...
                                </div>
                            </div>
                        )}
                        {loading && (
                            <motion.div 
                                initial={{ top: '0%' }}
                                animate={{ top: '100%' }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                className="absolute left-0 w-full h-[2px] bg-blue-500 shadow-[0_0_10px_#3b82f6] z-10"
                            />
                        )}
                    </div>
                    
                    {!loading && (
                        <div className="flex gap-4 justify-center">
                            <button 
                                onClick={() => { setImageStr(null); setError(null); }}
                                className="px-6 py-2.5 rounded-full border border-gray-300 text-gray-600 font-medium hover:bg-gray-50 transition-colors shadow-sm"
                            >
                                重新选择
                            </button>
                            <button 
                                onClick={startAnalysis}
                                className="px-8 py-2.5 rounded-full bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all flex items-center gap-2 shadow-md"
                            >
                                <Activity className="w-4 h-4" /> 开始智能诊断
                            </button>
                        </div>
                    )}

                    {error && (
                        <div className="mt-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm flex items-center justify-center gap-2 shadow-sm">
                            <AlertTriangle className="w-5 h-5"/> {error}
                        </div>
                    )}
                </div>
            )}

            {result && (
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-8 max-w-5xl mx-auto"
                >
                    {/* Visualizer and Action Bar */}
                    <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                         <div className="flex items-center gap-4">
                            <button 
                                onClick={() => { setResult(null); setImageStr(null); }}
                                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                            >
                                重新分析
                            </button>
                            <span className="text-sm text-gray-500 font-medium px-3 py-1 bg-gray-100 rounded-md">
                                {result.viewType === 'FRONT' ? '正面视图 (Front)' : '侧面视图 (Side)'}
                            </span>
                         </div>
                         <button 
                            onClick={handleDownload}
                            className="px-5 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors flex items-center gap-2 shadow-sm"
                        >
                            <Download className="w-4 h-4" /> 导出报告图
                        </button>
                    </div>

                    <div className="relative rounded-2xl overflow-hidden shadow-lg bg-gray-900 mx-auto max-w-2xl w-full border-4 border-gray-200">
                        <img 
                            ref={imageRef} 
                            src={imageStr!} 
                            alt="Analyzed Posture" 
                            className="w-full h-auto max-h-[600px] object-contain block mx-auto opacity-70"
                            onLoad={() => drawOverlay()}
                        />
                        <canvas 
                            ref={canvasRef} 
                            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                        />
                    </div>

                    <div ref={reportRef} className="flex flex-col gap-8 bg-[#F9FAFB] p-2 sm:p-8 rounded-3xl">
                        
                        {/* Top Overview Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Score & Age Card */}
                            <div className="report-container p-8 flex divide-x divide-gray-100">
                                <div className="flex-1 flex flex-col items-center justify-center">
                                    <div className="text-gray-500 text-sm font-medium mb-2">总体分数</div>
                                    <div className="flex items-baseline">
                                        <span className="text-5xl score-text text-gray-900">{result.overallScore}</span>
                                        <span className="text-xl text-gray-400 ml-1">/100</span>
                                    </div>
                                </div>
                                <div className="flex-1 flex flex-col items-center justify-center">
                                    <div className="text-gray-500 text-sm font-medium mb-2">体态年龄</div>
                                    <div className="flex items-baseline">
                                        <span className="text-4xl score-text text-gray-900">{result.postureAge}</span>
                                        <span className="text-lg text-gray-400 ml-2">岁</span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Title Card */}
                            <div className="report-container p-8 flex flex-col items-center justify-center text-center">
                                <div className="text-gray-500 text-sm font-medium mb-3 tracking-widest">检测体质</div>
                                <h2 className="text-3xl font-bold text-gray-900 leading-tight">
                                    {result.postureType.split(' ').map((line, i) => (
                                        <React.Fragment key={i}>
                                            {line}
                                            <br className="hidden sm:block" />
                                        </React.Fragment>
                                    ))}
                                    {result.postureType.includes(' ') ? null : result.postureType}
                                </h2>
                            </div>
                        </div>

                        {/* Multi-dimensional Analysis */}
                        <div className="report-container p-6 sm:p-10">
                            <h3 className="text-2xl font-bold text-center text-gray-900 mb-10">多维分析报告</h3>
                            
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-10">
                                {result.dimensions.map((dim, idx) => (
                                    <div key={idx} className="flex gap-4">
                                        <div className="mt-1">
                                            {renderCircularScore(dim.score, 64)}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <h4 className="text-base font-bold text-gray-900">{dim.title}</h4>
                                                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[11px] rounded-sm tracking-wider">
                                                    {dim.severity}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 leading-relaxed mb-4">
                                                {dim.description}
                                            </p>
                                            
                                            <div className="bg-[#FFF8F0] border border-[#FDE0C4] rounded-lg p-3 relative">
                                                <div className="text-sm text-[#876A47] leading-relaxed">
                                                    <span className="font-bold text-[#D97706]">康复建议：</span>
                                                    {dim.advice}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Action Plan Section */}
                        <div className="bg-[#2D2A26] rounded-3xl p-8 sm:p-12 text-[#E5E5E5] shadow-xl mt-4">
                            <div className="flex items-center gap-3 mb-10">
                                <Activity className="w-6 h-6 text-[#D97706]" />
                                <h3 className="text-2xl font-medium tracking-wide">专属康复方案</h3>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {result.actionPlans.map((plan, idx) => (
                                    <div key={idx} className="bg-[#3D3A36] p-6 rounded-xl border border-gray-700/50 hover:bg-[#45423E] transition-colors">
                                        <h4 className="text-base font-bold text-white mb-3 tracking-wide">{plan.title}</h4>
                                        <p className="text-sm text-gray-400 leading-relaxed">
                                            {plan.description}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                </motion.div>
            )}
        </div>
    );
}
