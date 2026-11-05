"use client";

import { useState, useEffect, useRef } from "react";

interface MediaFile {
  name: string;
  url: string;
  downloadUrl?: string;
  size: string;
  mediaType: "video" | "image" | "file";
}

interface Message {
  id: string;
  role: "user" | "bot";
  content?: string;
  files?: MediaFile[];
  error?: string;
  loading?: boolean;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "intro",
      role: "bot",
      content:
        "Hey! 👋 Paste any Pinterest, Instagram, or YouTube link below, and I'll fetch the original artifact for you.",
    },
  ]);
  const [inputUrl, setInputUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<MediaFile[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const STORAGE_KEY = "mediadrop_history";

  const loadHistory = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("pindrop_history");
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to load history from localStorage", e);
    }
  };

  const saveToHistory = (newFiles: MediaFile[]) => {
    try {
      setHistory((prev) => {
        const existingUrls = new Set(prev.map((f) => f.url));
        const toAdd = newFiles.filter((f) => !existingUrls.has(f.url));
        const updated = [...toAdd, ...prev].slice(0, 50);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      console.error("Failed to save history to localStorage", e);
    }
  };

  const removeHistoryItem = (nameToRemove: string) => {
    try {
      setHistory((prev) => {
        const updated = prev.filter((item) => item.name !== nameToRemove);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      console.error("Failed to remove history item", e);
    }
  };

  const clearHistory = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("pindrop_history");
      setHistory([]);
    } catch (e) {
      console.error("Failed to clear history", e);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleDownload = async (urlToSend?: string) => {
    const targetUrl = (urlToSend || inputUrl).trim();
    if (!targetUrl || isLoading) return;

    setInputUrl("");
    setIsLoading(true);

    const userMsgId = `user-${Date.now()}`;
    const botMsgId = `bot-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: targetUrl },
      { id: botMsgId, role: "bot", loading: true },
    ]);

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });

      const data = await res.json();

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === botMsgId) {
            if (data.success) {
              return {
                id: botMsgId,
                role: "bot",
                content: data.message,
                files: data.files,
              };
            } else {
              return {
                id: botMsgId,
                role: "bot",
                error: data.error || "Failed to download artifact.",
              };
            }
          }
          return msg;
        })
      );

      if (data.success && data.files && data.files.length > 0) {
        saveToHistory(data.files);
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMsgId
            ? {
                id: botMsgId,
                role: "bot",
                error: err.message || "Network error. Please try again.",
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  // IME-safe enter-to-submit per Modern Web Guidance
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Block submission if user is currently composing text with an IME (Japanese/Chinese/Korean) or Safari keyCode 229
      if (e.nativeEvent.isComposing || (e.nativeEvent as any).keyCode === 229) {
        return;
      }
      handleDownload();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#090a0f] text-[#f3f4f6]">
      {/* Background ambient glow */}
      <div className="fixed top-[-100px] left-1/2 -translate-x-1/2 w-[550px] h-[300px] bg-[radial-gradient(circle,rgba(168,40,218,0.2)_0%,rgba(255,42,95,0.1)_40%,transparent_70%)] pointer-events-none blur-[90px] z-0" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 bg-[#090a0f]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#FF2A5F] via-[#A828DA] to-[#3B82F6] flex items-center justify-center shadow-[0_0_16px_rgba(168,40,218,0.35)]">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v10m0 0l-4-4m4 4l4-4" />
              <path d="M5 16v1a3 3 0 003 3h8a3 3 0 003-3v-1" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
              MediaDrop
            </h1>
            <p className="text-[11px] text-gray-400">Media Downloader (Pinterest, Instagram &amp; YouTube)</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs text-gray-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
            Ready
          </div>
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Saved ({history.length})
          </button>
        </div>
      </header>

      {/* Chat Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-5 pb-8">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-[88%] ${
                msg.role === "user" ? "self-end flex-row-reverse" : "self-start"
              }`}
            >
              {msg.role === "bot" && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#FF2A5F] via-[#A828DA] to-[#3B82F6] flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(168,40,218,0.3)]">
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 4v10m0 0l-4-4m4 4l4-4" />
                    <path d="M5 16v1a3 3 0 003 3h8a3 3 0 003-3v-1" />
                  </svg>
                </div>
              )}

              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[#1f2433] text-gray-100 border border-white/10 rounded-br-xs"
                    : "bg-[#12141c] text-gray-200 border border-white/5 shadow-lg rounded-bl-xs"
                }`}
              >
                {msg.loading ? (
                  <div className="flex items-center gap-2.5 text-gray-400">
                    <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-[#A828DA] rounded-full animate-spin" />
                    <span>Fetching original artifact...</span>
                  </div>
                ) : (
                  <>
                    {msg.content && <p>{msg.content}</p>}

                    {msg.id === "intro" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => handleDownload("https://pin.it/Gk3NpJ8K0")}
                          className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs text-gray-300 transition cursor-pointer"
                        >
                          📌 Try: Pinterest Video
                        </button>
                        <button
                          onClick={() => handleDownload("https://www.instagram.com/reel/Chunk8-jurw/")}
                          className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs text-gray-300 transition cursor-pointer"
                        >
                          📸 Try: Instagram Reel
                        </button>
                        <button
                          onClick={() => handleDownload("https://www.youtube.com/watch?v=jNQXAC9IVRw")}
                          className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs text-gray-300 transition cursor-pointer"
                        >
                          🎬 Try: YouTube Video
                        </button>
                      </div>
                    )}

                    {msg.error && (
                      <div className="text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mt-1 text-xs">
                        <strong>Error:</strong> {msg.error}
                      </div>
                    )}

                    {msg.files && msg.files.length > 0 && (
                      <div className="mt-3 flex flex-col gap-3">
                        {msg.files.map((file, idx) => (
                          <div
                            key={idx}
                            className="bg-[#1a1e29] border border-white/10 rounded-xl overflow-hidden flex flex-col"
                          >
                            <div className="bg-black/60 flex items-center justify-center max-h-80 overflow-hidden">
                              {file.mediaType === "video" ? (
                                <video
                                  src={file.url}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="w-full max-h-80 object-contain"
                                />
                              ) : file.mediaType === "image" ? (
                                <img
                                  src={file.url}
                                  alt={file.name}
                                  className="w-full max-h-80 object-contain"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="p-8 text-center text-gray-400 text-xs">
                                  📄 {file.name}
                                </div>
                              )}
                            </div>

                            <div className="p-3 bg-[#12141c] border-t border-white/5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-200 truncate">
                                  {file.name}
                                </div>
                                <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                                  {file.size} • {file.mediaType.toUpperCase()}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <a
                                  href={file.downloadUrl || file.url}
                                  download={file.name}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#FF2A5F] to-[#A828DA] hover:opacity-90 text-white text-xs font-semibold rounded-lg shadow-[0_2px_10px_rgba(168,40,218,0.25)] transition"
                                >
                                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3" />
                                  </svg>
                                  Save
                                </a>
                                <a
                                  href={file.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-xs rounded-lg transition"
                                >
                                  Open
                                </a>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Floating Input Bar */}
      <footer className="relative z-10 px-4 py-4 bg-[#090a0f]/90 backdrop-blur-xl border-t border-white/5">
        <div className="max-w-2xl mx-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDownload();
            }}
            className="flex items-center gap-2 bg-[#12141c] border border-white/10 focus-within:border-[#A828DA] focus-within:ring-2 focus-within:ring-[#A828DA]/25 rounded-2xl px-3 py-1.5 transition"
          >
            <label htmlFor="media-url-input" className="sr-only">
              Media URL
            </label>
            <input
              ref={inputRef}
              id="media-url-input"
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste Pinterest (pin.it), Instagram, or YouTube link..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-gray-100 placeholder:text-gray-500 px-2 py-1.5"
              autoComplete="off"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!inputUrl.trim() || isLoading}
              aria-label="Send link"
              className="w-8 h-8 rounded-full bg-gradient-to-r from-[#FF2A5F] to-[#A828DA] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white transition flex-shrink-0 cursor-pointer shadow-[0_2px_8px_rgba(168,40,218,0.25)]"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
          <p className="text-center text-[11px] text-gray-500 mt-2">
            Press Enter to submit • Media saved to your browser history
          </p>
        </div>
      </footer>

      {/* History Drawer */}
      {isDrawerOpen && (
        <div
          onClick={() => setIsDrawerOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity"
        />
      )}
      <aside
        className={`fixed top-0 right-0 w-84 max-w-[88vw] h-full bg-[#12141c] border-l border-white/10 z-50 flex flex-col transition-transform duration-300 ease-out ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-100">Saved Media</h2>
            <span className="text-[10px] bg-white/10 text-gray-300 px-2 py-0.5 rounded-full font-mono">
              {history.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-[11px] text-gray-400 hover:text-red-400 transition cursor-pointer px-1.5 py-0.5"
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="text-gray-400 hover:text-gray-200 text-lg p-1 cursor-pointer leading-none"
              aria-label="Close drawer"
            >
              &times;
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
          {history.length === 0 ? (
            <div className="text-center py-12 text-xs text-gray-500">
              No saved downloads yet.<br />Artifacts you download will show up here.
            </div>
          ) : (
            history.map((item, idx) => (
              <div
                key={idx}
                className="bg-[#1a1e29] border border-white/5 rounded-lg p-3 flex flex-col gap-2 group hover:border-white/10 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-200 truncate" title={item.name}>
                      {item.name}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5 flex items-center gap-2">
                      <span className="px-1.5 py-0.2 bg-white/5 rounded text-[9px]">
                        {item.mediaType.toUpperCase()}
                      </span>
                      <span>{item.size}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeHistoryItem(item.name)}
                    className="text-gray-500 hover:text-red-400 p-0.5 transition cursor-pointer text-sm leading-none"
                    title="Remove from history"
                    aria-label={`Remove ${item.name} from history`}
                  >
                    &times;
                  </button>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                  <a
                    href={item.downloadUrl || item.url}
                    download={item.name}
                    className="flex-1 text-center py-1 bg-gradient-to-r from-[#FF2A5F] to-[#A828DA] hover:opacity-90 text-white text-[11px] font-medium rounded transition"
                  >
                    Save
                  </a>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-[11px] rounded transition"
                  >
                    Open
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
