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
2. Accurately identify key posture landmarks (strictly limit to 10-15 keypoints like Ear, Shoulder C-spine, Greater Trochanter/Hip, Knee, Lateral Malleolus/Ankle).
3. Determine posture deviations like Head Forward Posture, Rounded Shoulders, Anterior/Posterior Pelvic Tilt, Knee Hyperextension, Uneven Shoulders, etc.
4. Estimate the degree of the deviation where relevant (e.g., "骨盆前倾约 15°", "头前伸约 3cm").
5. Generate normalized coordinates (0.0 to 1.0) for drawing keypoints.
6. Generate normalized coordinates (0.0 to 1.0) for drawing auxiliary lines. ALWAYS generate an ideal plumb line (from ankle up) and lines showing actual deviation. Make deviation lines RED (#ef4444). (Limit to max 10 lines total).
7. Provide a CONCISE diagnostic report in Chinese (Markdown format, max 500 words) explaining the findings, potential long-term health risks, and brief corrective recommendations.

Return the response strictly adhering to the JSON schema. IMPORTANT: Keep the response compact to avoid truncation limits.`;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            viewType: { type: Type.STRING, description: "FRONT or SIDE photo view." },
            diagnostics: { type: Type.ARRAY, description: "List of top 3-5 findings in Chinese", items: { type: Type.STRING } },
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
            },
            report: {
                type: Type.STRING,
                description: "Concise markdown report in Chinese (max 500 words)."
            }
        },
        required: ["viewType", "diagnostics", "keypoints", "auxiliaryLines", "report"]
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
            console.error("JSON Parsing Error on Response:", text.substring(Math.max(0, text.length - 200))); // Log end of string where it likely truncated
            throw new Error(`Failed to parse AI response: ${(parseError as Error).message}`);
        }
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
}
