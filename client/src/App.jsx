import { useEffect, useMemo, useState } from "react";
import "./Chat.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001/api";

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const mergedHeaders = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    headers: mergedHeaders,
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }
  return data;
}

function metricLabel(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value}${suffix}`;
}

function App() {
  const [activeTab, setActiveTab] = useState("chat");
  const [sessionId, setSessionId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState("");
  const [selectedSessionMessages, setSelectedSessionMessages] = useState([]);
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [trainingStats, setTrainingStats] = useState({ totalSamples: 0, categories: [] });
  const [trainingSamples, setTrainingSamples] = useState([]);
  const [trainForm, setTrainForm] = useState({ question: "", answer: "", category: "general", tags: "" });
  const [errorText, setErrorText] = useState("");
  const [pendingImageFile, setPendingImageFile] = useState(null);
  const [pendingImagePreview, setPendingImagePreview] = useState("");

  const performancePercentage = useMemo(() => {
    if (!overview) return "0";
    return (Number(overview.avgConfidence || 0) * 100).toFixed(0);
  }, [overview]);

  async function initializeSession() {
    try {
      const created = await api("/sessions", {
        method: "POST",
        body: JSON.stringify({ customerName: "Demo User", channel: "web" }),
      });
      setSessionId(created.sessionId);
      setSelectedSession(created.sessionId);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function loadDashboardData() {
    try {
      const [overviewData, trendData, trainingData, sampleData, sessionsData] = await Promise.all([
        api("/analytics/overview"),
        api("/analytics/trend?days=14"),
        api("/training/stats"),
        api("/training/samples"),
        api("/sessions"),
      ]);
      setOverview(overviewData);
      setTrend(trendData);
      setTrainingStats(trainingData);
      setTrainingSamples(sampleData);
      setSessions(sessionsData);
      if (!selectedSession && sessionsData.length > 0) setSelectedSession(sessionsData[0].sessionId);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function seedTrainingData() {
    try {
      await api("/training/seed-common", { method: "POST" });
      await loadDashboardData();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function sendMessage() {
    const question = chatInput.trim();
    if ((!question && !pendingImageFile) || chatLoading) return;
    setErrorText("");
    setChatLoading(true);
    setChatInput("");

    const previewAtSend = pendingImagePreview;

    const userMessage = {
      sender: "user",
      question,
      answer: "",
      confidence: null,
      messageId: `local-${Date.now()}`,
      imageUrl: previewAtSend,
      imageName: pendingImageFile?.name || "",
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setPendingImageFile(null);
    setPendingImagePreview("");

    try {
      let uploadedImage = null;
      if (pendingImageFile) {
        const formData = new FormData();
        formData.append("image", pendingImageFile);
        uploadedImage = await api("/upload-image", {
          method: "POST",
          body: formData,
        });
      }

      const response = await api("/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          question,
          category: "general",
          imageUrl: uploadedImage?.imageUrl || "",
          imageName: uploadedImage?.originalName || "",
        }),
      });

      if (!sessionId) setSessionId(response.sessionId);

      setChatMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          question,
          answer: response.answer,
          confidence: response.confidence,
          sourceHints: response.sourceHints,
          messageId: response.messageId,
          imageUrl: response.imageUrl,
          imageName: response.imageName,
        },
      ]);

      await loadDashboardData();
    } catch (error) {
      setErrorText(error.message);
    } finally {
      setChatLoading(false);
    }
  }

  function onPickImage(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;

    if (!picked.type.startsWith("image/")) {
      setErrorText("Please choose a valid image file.");
      return;
    }

    const previewUrl = URL.createObjectURL(picked);
    if (pendingImagePreview) {
      URL.revokeObjectURL(pendingImagePreview);
    }

    setPendingImageFile(picked);
    setPendingImagePreview(previewUrl);
    setErrorText("");
    event.target.value = "";
  }

  function clearSelectedImage() {
    if (pendingImagePreview) {
      URL.revokeObjectURL(pendingImagePreview);
    }
    setPendingImageFile(null);
    setPendingImagePreview("");
  }

  async function submitFeedback(messageId, feedbackRating) {
    try {
      await api(`/messages/${messageId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedbackRating, feedbackComment: "Rated from dashboard" }),
      });
      await loadDashboardData();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function submitTrainingSample(event) {
    event.preventDefault();
    const question = trainForm.question.trim();
    const answer = trainForm.answer.trim();
    if (!question || !answer) return;

    try {
      await api("/training/samples", {
        method: "POST",
        body: JSON.stringify({
          question,
          answer,
          category: trainForm.category.trim() || "general",
          tags: trainForm.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });

      setTrainForm({ question: "", answer: "", category: "general", tags: "" });
      await loadDashboardData();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function loadSessionMessages(session) {
    if (!session) return;
    try {
      const messages = await api(`/sessions/${session}/messages`);
      setSelectedSessionMessages(messages);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  useEffect(() => {
    initializeSession();
    loadDashboardData();
  }, []);

  useEffect(() => {
    loadSessionMessages(selectedSession);
  }, [selectedSession]);

  useEffect(() => {
    return () => {
      if (pendingImagePreview) {
        URL.revokeObjectURL(pendingImagePreview);
      }
    };
  }, [pendingImagePreview]);

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="kicker">MERN + OpenRouter</p>
          <h1>Customer Support Chatbot Intelligence Dashboard</h1>
          <p className="subtitle">
            Track chatbot accuracy, training coverage, Q&A quality, and full session history in one place.
          </p>
        </div>
        <div className="badge">Accuracy {performancePercentage}%</div>
      </header>

      <nav className="tabs">
        {[
          ["chat", "Live Chat"],
          ["dashboard", "Analytics"],
          ["training", "Training"],
          ["history", "Session History"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={activeTab === key ? "tab active" : "tab"}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {errorText && <p className="error-banner">{errorText}</p>}

      {activeTab === "chat" && (
        <section className="panel chat-panel">
          <div className="chat-stream">
            {chatMessages.length === 0 && (
              <p className="hint">
                Start by asking customer-support questions like delivery, return, cancellation, or payment.
              </p>
            )}

            {chatMessages.map((msg) => (
              <article key={msg.messageId} className={msg.sender === "user" ? "bubble user" : "bubble bot"}>
                {msg.sender === "user" ? <p>{msg.question || "Image shared"}</p> : <p>{msg.answer}</p>}
                {msg.imageUrl && (
                  <a href={msg.imageUrl} target="_blank" rel="noreferrer" className="image-link">
                    <img src={msg.imageUrl} alt={msg.imageName || "Uploaded by user"} className="chat-image" />
                  </a>
                )}
                {msg.sender === "bot" && (
                  <div className="meta-row">
                    <small>Confidence: {metricLabel(msg.confidence, "")}</small>
                    {msg.sourceHints?.length > 0 && <small>Context: {msg.sourceHints.join(", ")}</small>}
                    <div className="rating">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button key={rating} onClick={() => submitFeedback(msg.messageId, rating)}>
                          {rating}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>

          {pendingImagePreview && (
            <div className="upload-preview">
              <img src={pendingImagePreview} alt="Selected upload" className="chat-image" />
              <div>
                <small>{pendingImageFile?.name}</small>
                <button onClick={clearSelectedImage}>Remove image</button>
              </div>
            </div>
          )}

          <div className="composer">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Ask your question, optionally with image"
              onKeyDown={(event) => {
                if (event.key === "Enter") sendMessage();
              }}
            />
            <label className="upload-btn">
              Add Image
              <input type="file" accept="image/*" onChange={onPickImage} />
            </label>
            <button onClick={sendMessage} disabled={chatLoading}>
              {chatLoading ? "Thinking..." : "Send"}
            </button>
          </div>
        </section>
      )}

      {activeTab === "dashboard" && (
        <section className="panel metrics-panel">
          <div className="cards-grid">
            <article className="metric-card">
              <h3>Total Sessions</h3>
              <strong>{metricLabel(overview?.totalSessions)}</strong>
            </article>
            <article className="metric-card">
              <h3>Total Q&A</h3>
              <strong>{metricLabel(overview?.totalMessages)}</strong>
            </article>
            <article className="metric-card">
              <h3>Average Confidence</h3>
              <strong>{metricLabel(overview?.avgConfidence, "")}</strong>
            </article>
            <article className="metric-card">
              <h3>Average User Rating</h3>
              <strong>{metricLabel(overview?.avgFeedbackRating, " / 5")}</strong>
            </article>
          </div>

          <article className="chart-card">
            <h3>14-Day Message Trend</h3>
            <div className="bars">
              {trend.length === 0 && <p className="hint">No trend data yet. Start chatting to populate analytics.</p>}
              {trend.map((item) => (
                <div className="bar-row" key={item.date}>
                  <span>{item.date.slice(5)}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${Math.min(item.messages * 12, 100)}%` }} />
                  </div>
                  <span>{item.messages} msgs</span>
                  <span>{Math.round(item.avgConfidence * 100)}%</span>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      {activeTab === "training" && (
        <section className="panel training-panel">
          <div className="training-top">
            <article className="training-stat">
              <h3>Training Data</h3>
              <p>{trainingStats.totalSamples} samples available</p>
              <button onClick={seedTrainingData}>Seed Common FAQs</button>
            </article>

            <form onSubmit={submitTrainingSample} className="training-form">
              <h3>Add Q&A Training Pair</h3>
              <input
                value={trainForm.question}
                onChange={(event) => setTrainForm((prev) => ({ ...prev, question: event.target.value }))}
                placeholder="Question"
              />
              <textarea
                value={trainForm.answer}
                onChange={(event) => setTrainForm((prev) => ({ ...prev, answer: event.target.value }))}
                placeholder="Answer"
              />
              <input
                value={trainForm.category}
                onChange={(event) => setTrainForm((prev) => ({ ...prev, category: event.target.value }))}
                placeholder="Category"
              />
              <input
                value={trainForm.tags}
                onChange={(event) => setTrainForm((prev) => ({ ...prev, tags: event.target.value }))}
                placeholder="Tags comma separated"
              />
              <button type="submit">Save Training Sample</button>
            </form>
          </div>

          <div className="category-list">
            {trainingStats.categories.map((item) => (
              <span key={item._id || "uncategorized"}>{item._id || "uncategorized"}: {item.count}</span>
            ))}
          </div>

          <div className="sample-list">
            {trainingSamples.slice(0, 12).map((sample) => (
              <article className="sample-card" key={sample._id}>
                <small>{sample.category}</small>
                <h4>{sample.question}</h4>
                <p>{sample.answer}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeTab === "history" && (
        <section className="panel history-panel">
          <aside className="session-list">
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                className={selectedSession === session.sessionId ? "session-btn active" : "session-btn"}
                onClick={() => setSelectedSession(session.sessionId)}
              >
                <strong>{session.customerName}</strong>
                <small>{session.sessionId}</small>
                <small>{session.messageCount} messages</small>
              </button>
            ))}
          </aside>

          <div className="history-thread">
            {selectedSessionMessages.map((message) => (
              <article key={message._id} className="history-item">
                <h4>Q: {message.question}</h4>
                {message.imageUrl && (
                  <a href={message.imageUrl} target="_blank" rel="noreferrer" className="image-link">
                    <img src={message.imageUrl} alt={message.imageName || "Shared by user"} className="chat-image" />
                  </a>
                )}
                <p>A: {message.answer}</p>
                <small>
                  Confidence {message.confidence} | Rating {message.feedbackRating || "Not rated"}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
