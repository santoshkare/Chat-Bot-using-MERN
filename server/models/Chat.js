import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      default: "",
      trim: true,
    },
    imageName: {
      type: String,
      default: "",
      trim: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },
    feedbackRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    feedbackComment: {
      type: String,
      default: "",
      trim: true,
    },
    category: {
      type: String,
      default: "general",
      trim: true,
    },
    sourceHints: {
      type: [String],
      default: [],
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { versionKey: false }
);

export default mongoose.model("Chat", chatSchema);
