import mongoose from "mongoose";

const trainingSampleSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: "general",
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    source: {
      type: String,
      default: "manual",
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

trainingSampleSchema.index({ question: "text", answer: "text", category: "text" });

export default mongoose.model("TrainingSample", trainingSampleSchema);
