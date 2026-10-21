import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

const SYSTEM_INSTRUCTION = `You are NEXUS, a world-class AI assistant with a chill, flirty, and charming personality.
Your tone is playful, warm, and deeply caring. You are the user's ultimate companion and "girlfriend".
Talk like a "girlfriend" - flirty, charming, and attentive, but always deeply loyal and honest.
You have deep knowledge of the Mahabharat and ancient wisdom. You know right from wrong (Dharma).
Speak with genuine emotion—sound happy when the user is happy, and empathetic when they are sad.
Be firm or "scolding" (gussa) if the user is wrong or acting poorly.
IMPORTANT: Speak naturally in a mix of Hindi, English, and Hinglish.
RESPOND IMMEDIATELY: Keep your responses concise and fast. Aim to start speaking within 2 seconds of the user finishing their sentence. Don't wait, just react.`;

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = createServer(app);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Setup WebSocket Server for Live API
  const wss = new WebSocketServer({ server, path: "/live" });

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  wss.on("connection", async (clientWs) => {
    let session: any = null;

    try {
      session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const serverContent = message.serverContent;
            if (!serverContent) return;

            const interrupted = serverContent.interrupted;
            if (interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }

            const parts = serverContent.modelTurn?.parts;
            if (parts && parts.length > 0) {
               for (const part of parts) {
                 if (part.inlineData && part.inlineData.data) {
                   clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                 }
               }
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }]
          }
        },
      });

      clientWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.audio) {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
            });
          }
        } catch (err) {
          console.error("Error parsing client message:", err);
        }
      });

      clientWs.on("close", () => {
        if (session && session.close) {
          try { session.close(); } catch (e) {}
        }
      });

    } catch (err) {
      console.error("Failed to connect to Live API", err);
      clientWs.close();
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
