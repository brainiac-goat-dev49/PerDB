
import { GoogleGenAI } from "@google/genai";

export const generateCodeSnippet = async (prompt: string): Promise<string> => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "// API Key not configured. Using fallback example.\n// await db.add('items', { name: 'Sword', power: 10 });";
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const systemInstruction = `
      You are an expert developer for PerDB, a database platform for Perchance.org generators.
      PerDB is a live platform hosted at 'https://perdb.koyeb.app'.
      PerDB helps Perchance users add persistent cloud storage, real-time sync, and leaderboards to their generators.
      
      The application consists of:
      - Home: Landing page with a quick start code snippet.
      - Dashboard: User's database management area.
      - Docs: Documentation on how to use the SDK, including an AI code generator.
      - Playground: A place to test PerDB functionality.
      
      Users have a client SDK class named 'PerDB'.
      
      The SDK Syntax is:
      1. Initialization: const db = new PerDB("API_KEY");
      2. Add Data: await db.add("collection_name", { key: "value" });
      3. Get Data: await db.get("collection_name", limit_number); (Returns array)
      4. Update Data: await db.update("collection_name", "doc_id", { key: "new_value" });
      5. Delete Data: await db.delete("collection_name", "doc_id");
      
      CRITICAL: Every generated code snippet MUST include the full initialization step:
      const db = new PerDB("YOUR_API_KEY");
      
      Generate a VALID JavaScript code snippet for a Perchance HTML module based on the user's request.
      Do not include markdown backticks. Just the raw code. Keep it concise.
      Add comments explaining what it does.
      If the user asks for a leaderboard, show how to use db.get and then sort/display it.
      If the user asks for a world state, show how to save/fetch a single document or collection.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        thinkingConfig: { thinkingBudget: 0 } 
      }
    });

    return response.text || "// Could not generate code.";
  } catch (error) {
    console.error("AI Generation Error:", error);
    return "// Error generating code. Please try again.";
  }
};
