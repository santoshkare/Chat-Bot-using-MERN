import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customerName: {
      type: String,
      default: "Guest User",
      trim: true,
    },
    channel: {
      type: String,
      default: "web",
      trim: true,
    },
    status: {
      type: String,
      default: "active",
      enum: ["active", "closed"],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

export default mongoose.model("Session", sessionSchema);
