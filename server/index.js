import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Chat from "./models/Chat.js";
import Session from "./models/Session.js";
import TrainingSample from "./models/TrainingSample.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 5000);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/ai-chatbot";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const OPENROUTER_VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || "openai/gpt-4o";
const HAS_VALID_OPENROUTER_KEY =
  Boolean(OPENROUTER_API_KEY) && !OPENROUTER_API_KEY.includes("your_openrouter_api_key_here");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDirectory = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDirectory)) {
  fs.mkdirSync(uploadsDirectory, { recursive: true });
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const IMAGE_EXTENSION_TO_MIME_TYPE = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDirectory);
  },
  filename: (_req, file, cb) => {
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const extension = path.extname(safeOriginalName) || ".jpg";
    const baseName = path.basename(safeOriginalName, extension).slice(0, 50) || "upload";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e8)}-${baseName}${extension}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Only jpeg, png, webp, and gif image files are allowed"));
    }
    cb(null, true);
  },
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadsDirectory));

const COMMON_TRAINING_DATA = [
  {
    question: "How can I return a product?",
    answer:
      "You can return a product within 7 days of delivery from the orders page. The refund is usually processed in 3 to 5 business days after pickup.",
    category: "returns",
    tags: ["return", "refund", "orders"],
    source: "seed",
  },
  {
    question: "How long does delivery take?",
    answer:
      "Standard delivery takes 3 to 5 business days. Express delivery is available in selected locations and usually arrives within 1 to 2 days.",
    category: "shipping",
    tags: ["delivery", "shipping", "timeline"],
    source: "seed",
  },
  {
    question: "Can I cancel my order?",
    answer:
      "Yes. You can cancel an order before it is marked as shipped in your order history. If already shipped, you can still initiate a return after delivery.",
    category: "orders",
    tags: ["cancel", "orders"],
    source: "seed",
  },
  {
    question: "How do I contact customer support?",
    answer:
      "You can contact support by live chat, email at support@example.com, or call the helpline between 9 AM and 9 PM.",
    category: "support",
    tags: ["contact", "support"],
    source: "seed",
  },
  {
    question: "Do you offer cash on delivery?",
    answer:
      "Cash on delivery is available for eligible products and selected pin codes. You can see availability on the checkout page.",
    category: "payments",
    tags: ["cod", "payment", "checkout"],
    source: "seed",
  },
];

function createSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function overlapScore(question, sample) {
  const tokens = new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
  if (!tokens.size) return 0;

  const sampleText = `${sample.question} ${sample.answer} ${(sample.tags || []).join(" ")}`.toLowerCase();
  let matched = 0;
  for (const token of tokens) {
    if (sampleText.includes(token)) matched += 1;
  }

  return matched / tokens.size;
}

function calculateConfidence(question, answer, usedContextCount) {
  const uncertaintyWords = ["maybe", "might", "not sure", "cannot", "unable", "unknown"];
  const answerLc = answer.toLowerCase();
  const uncertaintyPenalty = uncertaintyWords.some((word) => answerLc.includes(word)) ? 0.15 : 0;
  const lengthBoost = Math.min(answer.length / 400, 0.25);
  const contextBoost = Math.min(usedContextCount * 0.06, 0.2);
  const questionCoverage = Math.min(question.length > 0 ? answer.length / Math.max(question.length * 2.2, 1) : 0, 0.2);

  const score = 0.35 + lengthBoost + contextBoost + questionCoverage - uncertaintyPenalty;
  return Number(Math.max(0, Math.min(1, score)).toFixed(2));
}

function isCurrentTimeQuestion(question) {
  const q = question.toLowerCase().trim();
  const directPatterns = [
    "what is time",
    "what's the time",
    "current time",
    "time now",
    "tell me the time",
  ];

  return directPatterns.some((pattern) => q.includes(pattern));
}

function getCurrentTimeAnswer() {
  const now = new Date();
  const readable = now.toLocaleString("en-IN", { hour12: true, timeZoneName: "short" });
  return `Current server time is ${readable}.`;
}

function looksLikeClarificationPrompt(answer) {
  if (!answer) return false;
  const text = answer.toLowerCase();
  return (
    text.includes("could you please clarify") ||
    text.includes("can you clarify") ||
    text.includes("do you mean") ||
    text.includes("are you asking about")
  );
}

function looksLikeImageCapabilityRefusal(answer) {
  if (!answer) return false;
  const text = answer.toLowerCase();

  const hasImageWord =
    text.includes("image") ||
    text.includes("photo") ||
    text.includes("picture") ||
    text.includes("pic");

  const hasRefusalWord =
    text.includes("cannot") ||
    text.includes("can't") ||
    text.includes("unable") ||
    text.includes("sorry");

  const hasVisionActionWord =
    text.includes("view") ||
    text.includes("see") ||
    text.includes("analyze") ||
    text.includes("describe") ||
    text.includes("access");

  return (
    (hasImageWord && hasRefusalWord && hasVisionActionWord) ||
    text.includes("i cannot view or analyze images") ||
    text.includes("i can't describe the image")
  );
}

async function getTrainingContext(question) {
  const samples = await TrainingSample.find().limit(200).lean();
  const ranked = samples
    .map((sample) => ({ sample, score: overlapScore(question, sample) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .filter((item) => item.score > 0);

  return ranked.map((item) => item.sample);
}

async function resolveModelImageInput(imageUrl) {
  if (!imageUrl) return "";

  try {
    const parsed = new URL(imageUrl);
    const safeFilename = path.basename(parsed.pathname);

    if (!safeFilename) return imageUrl;

    const resolvedPath = path.join(uploadsDirectory, safeFilename);
    if (!fs.existsSync(resolvedPath)) return imageUrl;

    const extension = path.extname(safeFilename).toLowerCase();
    const mimeType = IMAGE_EXTENSION_TO_MIME_TYPE[extension] || "image/jpeg";
    const fileBuffer = await fs.promises.readFile(resolvedPath);
    return `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
  } catch {
    return imageUrl;
  }
}

async function generateOpenRouterResponse(
  question,
  contextSnippets,
  recentMessages = [],
  forceDirectAnswer = false,
  imageInput = ""
) {
  if (isCurrentTimeQuestion(question)) {
    return getCurrentTimeAnswer();
  }

  if (!HAS_VALID_OPENROUTER_KEY) {
    if (contextSnippets.length > 0) {
      return `${contextSnippets[0].answer} (fallback response from local training data)`;
    }
    return "I could not access the AI model because OPENROUTER_API_KEY is not configured. Please add a valid key in server/.env.";
  }

  const contextText = contextSnippets
    .map(
      (sample, idx) =>
        `Reference ${idx + 1}:\nQ: ${sample.question}\nA: ${sample.answer}\nCategory: ${sample.category}`
    )
    .join("\n\n");

  const conversationContext = recentMessages
    .slice(-6)
    .flatMap((message) => [
      { role: "user", content: message.question },
      { role: "assistant", content: message.answer },
    ]);

  const userContent = imageInput
    ? [
        { type: "text", text: question },
        { type: "image_url", image_url: { url: imageInput } },
      ]
    : question;

  const messages = [
    {
      role: "system",
      content:
        "You are a customer support chatbot. Give concise, accurate, and polite answers. If the user asks multiple questions in one message, answer every question point in a numbered list. Do not skip any part.",
    },
    forceDirectAnswer
      ? {
          role: "system",
          content:
            "Do not ask clarification questions. Give the best direct answer immediately using reasonable assumptions and include a brief note about the assumption if needed.",
        }
      : null,
    {
      role: "system",
      content: contextText
        ? `Use this training knowledge when relevant:\n${contextText}`
        : "No matching training snippets found. Use general customer support best practices.",
    },
    ...conversationContext,
    {
      role: "user",
      content: userContent,
    },
  ].filter(Boolean);

  const requestOptions = {
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "Customer Support Chatbot",
    },
    timeout: 30000,
  };

  const runCompletion = async (modelName) => {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: modelName,
        messages,
        temperature: 0.3,
        max_tokens: 700,
      },
      requestOptions
    );

    return response?.data?.choices?.[0]?.message?.content || "";
  };

  let answer = await runCompletion(OPENROUTER_MODEL);
  if (imageInput && looksLikeImageCapabilityRefusal(answer) && OPENROUTER_MODEL !== OPENROUTER_VISION_MODEL) {
    const retryAnswer = await runCompletion(OPENROUTER_VISION_MODEL);
    if (retryAnswer) answer = retryAnswer;
  }

  return answer || "I could not generate a response right now.";
}

function uploadToPromise(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("image")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function buildImageUrl(req, filename) {
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "customer-support-chatbot",
    openRouterConfigured: HAS_VALID_OPENROUTER_KEY,
  });
});

app.post("/api/sessions", async (req, res) => {
  try {
    const customerName = (req.body?.customerName || "Guest User").trim();
    const channel = (req.body?.channel || "web").trim();
    const sessionId = createSessionId();
    const session = await Session.create({ sessionId, customerName, channel });
    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ error: "Failed to create session" });
  }
});

app.get("/api/sessions", async (req, res) => {
  try {
    const sessions = await Session.find().sort({ updatedAt: -1 }).limit(50).lean();
    const sessionIds = sessions.map((session) => session.sessionId);
    const counts = await Chat.aggregate([
      { $match: { sessionId: { $in: sessionIds } } },
      {
        $group: {
          _id: "$sessionId",
          messages: { $sum: 1 },
          avgConfidence: { $avg: "$confidence" },
          lastMessageAt: { $max: "$timestamp" },
        },
      },
    ]);

    const countMap = counts.reduce((acc, item) => {
      acc[item._id] = item;
      return acc;
    }, {});

    const enriched = sessions.map((session) => ({
      ...session,
      messageCount: countMap[session.sessionId]?.messages || 0,
      avgConfidence: Number((countMap[session.sessionId]?.avgConfidence || 0).toFixed(2)),
      lastMessageAt: countMap[session.sessionId]?.lastMessageAt || null,
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

app.get("/api/sessions/:sessionId/messages", async (req, res) => {
  try {
    const messages = await Chat.find({ sessionId: req.params.sessionId }).sort({ timestamp: 1 }).lean();
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Failed to load session messages" });
  }
});

app.post("/api/chat", async (req, res) => {
  const question = (req.body?.question || "").trim();
  const imageUrl = (req.body?.imageUrl || "").trim();
  const imageName = (req.body?.imageName || "").trim();
  const category = (req.body?.category || "general").trim();
  let sessionId = (req.body?.sessionId || "").trim();

  if (!question && !imageUrl) {
    return res.status(400).json({ error: "Question or image is required" });
  }

  try {
    if (!sessionId) {
      sessionId = createSessionId();
      await Session.create({ sessionId, customerName: "Guest User" });
    }

    const session = await Session.findOne({ sessionId });
    if (!session) {
      await Session.create({ sessionId, customerName: "Guest User" });
    }

    const effectiveQuestion = question || "User shared an image and needs support help.";
    const imageInput = await resolveModelImageInput(imageUrl);
    const questionForModel = imageUrl ? `${effectiveQuestion}\nImage name: ${imageName || "uploaded-image"}` : effectiveQuestion;
    const contextSnippets = await getTrainingContext(questionForModel);
    const recentMessages = await Chat.find({ sessionId }).sort({ timestamp: -1 }).limit(6).lean();
    let answer = await generateOpenRouterResponse(
      questionForModel,
      contextSnippets,
      recentMessages.reverse(),
      false,
      imageInput
    );
    if (looksLikeClarificationPrompt(answer)) {
      answer = await generateOpenRouterResponse(
        questionForModel,
        contextSnippets,
        recentMessages.reverse(),
        true,
        imageInput
      );
    }
    const confidence = calculateConfidence(questionForModel, answer, contextSnippets.length);

    const savedChat = await Chat.create({
      sessionId,
      question: effectiveQuestion,
      imageUrl,
      imageName,
      answer,
      confidence,
      category,
      sourceHints: contextSnippets.map((item) => item.category || "general"),
      timestamp: new Date(),
    });

    await Session.updateOne({ sessionId }, { $set: { updatedAt: new Date() } });

    return res.status(201).json({
      sessionId,
      messageId: savedChat._id,
      answer,
      confidence,
      sourceHints: savedChat.sourceHints,
      imageUrl: savedChat.imageUrl,
      imageName: savedChat.imageName,
    });
  } catch (error) {
    const fallback = "I am unable to reach OpenRouter right now. Please try again shortly or contact support.";
    const fallbackConfidence = 0.3;
    const effectiveQuestion = question || "User shared an image and needs support help.";

    const savedChat = await Chat.create({
      sessionId,
      question: effectiveQuestion,
      imageUrl,
      imageName,
      answer: fallback,
      confidence: fallbackConfidence,
      category,
      sourceHints: ["fallback"],
      timestamp: new Date(),
    });

    await Session.updateOne({ sessionId }, { $set: { updatedAt: new Date() } });

    return res.status(201).json({
      sessionId,
      messageId: savedChat._id,
      answer: fallback,
      confidence: fallbackConfidence,
      sourceHints: ["fallback"],
      imageUrl: savedChat.imageUrl,
      imageName: savedChat.imageName,
      warning: error.response?.data?.error?.message || "OpenRouter unavailable",
    });
  }
});

app.post("/api/upload-image", async (req, res) => {
  try {
    await uploadToPromise(req, res);
    if (!req.file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    return res.status(201).json({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      imageUrl: buildImageUrl(req, req.file.filename),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to upload image" });
  }
});

app.post("/api/messages/:messageId/feedback", async (req, res) => {
  try {
    const feedbackRating = Number(req.body?.feedbackRating);
    const feedbackComment = (req.body?.feedbackComment || "").trim();

    if (!Number.isFinite(feedbackRating) || feedbackRating < 1 || feedbackRating > 5) {
      return res.status(400).json({ error: "feedbackRating must be between 1 and 5" });
    }

    const updated = await Chat.findByIdAndUpdate(
      req.params.messageId,
      { feedbackRating, feedbackComment },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: "Message not found" });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

app.get("/api/training/samples", async (req, res) => {
  try {
    const samples = await TrainingSample.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json(samples);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch training samples" });
  }
});

app.post("/api/training/samples", async (req, res) => {
  try {
    const question = (req.body?.question || "").trim();
    const answer = (req.body?.answer || "").trim();
    const category = (req.body?.category || "general").trim();
    const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];

    if (!question || !answer) {
      return res.status(400).json({ error: "Question and answer are required" });
    }

    const created = await TrainingSample.create({
      question,
      answer,
      category,
      tags,
      source: "manual",
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: "Failed to create training sample" });
  }
});

app.post("/api/training/seed-common", async (req, res) => {
  try {
    let inserted = 0;
    for (const sample of COMMON_TRAINING_DATA) {
      const exists = await TrainingSample.findOne({ question: sample.question });
      if (!exists) {
        await TrainingSample.create(sample);
        inserted += 1;
      }
    }

    res.json({ inserted, totalSeedSamples: COMMON_TRAINING_DATA.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to seed training samples" });
  }
});

app.get("/api/training/stats", async (req, res) => {
  try {
    const totalSamples = await TrainingSample.countDocuments();
    const categories = await TrainingSample.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json({ totalSamples, categories });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch training stats" });
  }
});

app.get("/api/analytics/overview", async (req, res) => {
  try {
    const [totalSessions, totalMessages, confidenceData, feedbackData, unresolvedCount] = await Promise.all([
      Session.countDocuments(),
      Chat.countDocuments(),
      Chat.aggregate([{ $group: { _id: null, avgConfidence: { $avg: "$confidence" } } }]),
      Chat.aggregate([
        { $match: { feedbackRating: { $ne: null } } },
        { $group: { _id: null, avgFeedback: { $avg: "$feedbackRating" } } },
      ]),
      Chat.countDocuments({ confidence: { $lt: 0.5 } }),
    ]);

    res.json({
      totalSessions,
      totalMessages,
      avgConfidence: Number((confidenceData[0]?.avgConfidence || 0).toFixed(2)),
      avgFeedbackRating: Number((feedbackData[0]?.avgFeedback || 0).toFixed(2)),
      lowConfidenceResponses: unresolvedCount,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch analytics overview" });
  }
});

app.get("/api/analytics/trend", async (req, res) => {
  try {
    const days = Math.max(1, Math.min(60, Number(req.query.days || 14)));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    const trend = await Chat.aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            day: { $dayOfMonth: "$timestamp" },
          },
          messages: { $sum: 1 },
          avgConfidence: { $avg: "$confidence" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
    ]);

    const formatted = trend.map((item) => {
      const label = `${item._id.year}-${String(item._id.month).padStart(2, "0")}-${String(
        item._id.day
      ).padStart(2, "0")}`;
      return {
        date: label,
        messages: item.messages,
        avgConfidence: Number((item.avgConfidence || 0).toFixed(2)),
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch analytics trend" });
  }
});

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect server:", error.message);
    process.exit(1);
  }
}

startServer();
