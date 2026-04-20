import { GoogleGenAI, Type } from "@google/genai";

let ai: GoogleGenAI;

export async function analyzePosture(base64Image: string, mimeType: string, saasContext?: string, saasPrompt?: string[]) {
    if (!ai) {
      ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || "" });
    }

    let extraContext = "";
    if (saasContext && saasContext.trim() !== "" && saasContext !== "null" && saasContext !== "undefined") {
        extraContext += `\n[SaaS Content Subject]: ${saasContext}\n`;
    }
    if (saasPrompt && saasPrompt.length > 0 && saasPrompt[0] !== "null" && saasPrompt[0] !== "undefined") {
        extraContext += `\n[SaaS Supplementary Keywords]: ${saasPrompt.join(", ")}\n`;
    }

    const prompt = `You are an expert physical therapist and posture analyst. Analyze the provided full-body photo of a person wearing tight or fitting clothing.
    
    ${extraContext ? `### ADDITIONAL REQUIREMENTS FROM SAAS\n${extraContext}\nPlease incorporate these specific subjects and keywords into your report analysis style, content, or focus areas appropriately.\n` : ""}

1. Determine if the photo is a FRONT or SIDE view.
2. Evaluate the overall posture and calculate an Overall Score (0-100).
3. Estimate a "Posture Age" (body physiological age based on structural health).
4. Identify the main posture type (e.g., 骨盆前倾倾向体态, 颈椎曲度变直, 良好体态).
5. Conduct a MULTI-DIMENSIONAL analysis. Analyze at least 6-8 different bodily dimensions thoroughly (e.g., 颈部前倾度, 肩膀平齐度, 脊柱生理弯曲, 骨盆倾角, 膝关节/小腿生理形态, 足弓/踝关节状态, 身体重心平衡等). For each, provide a score, severity, description, and advice.
6. Provide specific, tailored action plans for rehabilitation.
7. Accurately identify key posture landmarks (strictly limit to 10-15 keypoints like Ear, Shoulder C-spine, Greater Trochanter/Hip, Knee, Lateral Malleolus/Ankle). Generate normalized coordinates (0.0 to 1.0) and labels.
8. Generate normalized coordinates (0.0 to 1.0) for drawing auxiliary lines. ALWAYS generate an ideal plumb line (from ankle up) and lines showing actual deviation. Make deviation lines RED (#ef4444). (Limit to max 10 lines total).

Return the response strictly adhering to the JSON schema. Ensure the response is in Chinese and highly professional. Limit text length appropriately to avoid token truncation.`;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            viewType: { type: Type.STRING, description: "FRONT or SIDE photo view." },
            overallScore: { type: Type.INTEGER, description: "Overall posture score 0-100" },
            postureAge: { type: Type.INTEGER, description: "Estimated posture age" },
            postureType: { type: Type.STRING, description: "Primary posture classification" },
            dimensions: {
                type: Type.ARRAY,
                description: "6-8 detailed posture analysis dimensions. BE COMPREHENSIVE.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "Dimension name, e.g., 头部前伸度, 骨盆倾斜评估" },
                        score: { type: Type.INTEGER, description: "Score for this dimension 0-100" },
                        severity: { type: Type.STRING, description: "Severity label, e.g., 正常, 极轻微, 轻度, 中度, 严重" },
                        description: { type: Type.STRING, description: "Detailed description of the observation" },
                        advice: { type: Type.STRING, description: "Specific corrective advice" }
                    }
                }
            },
            actionPlans: {
                type: Type.ARRAY,
                description: "3-4 specific, actionable rehabilitation plans.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "Plan name" },
                        description: { type: Type.STRING, description: "Detailed instruction" }
                    }
                }
            },
            keypoints: {
                type: Type.ARRAY,
                description: "Landmarks with normalized x/y (0 to 1). Max 15 items.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        label: { type: Type.STRING },
                        x: { type: Type.NUMBER },
                        y: { type: Type.NUMBER }
                    }
                }
            },
            auxiliaryLines: {
                type: Type.ARRAY,
                description: "Connecting lines. Max 10 items.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        label: { type: Type.STRING },
                        startX: { type: Type.NUMBER },
                        startY: { type: Type.NUMBER },
                        endX: { type: Type.NUMBER },
                        endY: { type: Type.NUMBER },
                        color: { type: Type.STRING, description: "#ef4444 for warning, #eab308 for mild, #22c55e for good, #3b82f6 for reference baseline" },
                        dashed: { type: Type.BOOLEAN, description: "true if reference/ideal line, false for actual alignment" }
                    }
                }
            }
        },
        required: ["viewType", "overallScore", "postureAge", "postureType", "dimensions", "actionPlans", "keypoints", "auxiliaryLines"]
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: [
                prompt,
                { inlineData: { data: base64Image, mimeType: mimeType } }
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0.2, // Low temp for analytical consistency
            }
        });

        let text = response.text;
        if (!text) {
             throw new Error("No response from AI");
        }
        
        // Sometimes the AI returns markdown blocks despite application/json
        text = text.replace(/^```json\n/, "").replace(/\n```$/, "").trim();

        try {
            return JSON.parse(text);
        } catch (parseError) {
            // Log parse errors internally, but don't leak raw JSON text if it's too long
            throw new Error(`Failed to parse AI response: ${(parseError as Error).message}`);
        }
    } catch (error: any) {
        // We throw the error directly so the UI can catch and format the quota/demand messages,
        // without dumping it to console.error which triggers the AI Studio log agent.
        throw error;
    }
}
