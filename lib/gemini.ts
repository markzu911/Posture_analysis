export async function analyzePosture(base64Image: string | null, mimeType: string, saasContext?: string, saasPrompt?: string[]) {
    const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "gemini-2.5-pro",
            base64Image,
            mimeType,
            saasContext,
            saasPrompt,
        }),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
    }

    return data;
}
