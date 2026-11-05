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
        "Hey! 👋 Paste any Pinterest link (pin, video, board) or Instagram link (Reel, Post, Share link) below, and I'll fetch the original artifact for you.",
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

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/history");
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  useEffect(() => {
    fetchHistory();
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

      fetchHistory();
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
      {/* Background ambient red glow */}
      <div className="fixed top-[-100px] left-1/2 -translate-x-1/2 w-[550px] h-[300px] bg-[radial-gradient(circle,rgba(230,0,35,0.18)_0%,transparent_70%)] pointer-events-none blur-[90px] z-0" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 bg-[#090a0f]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#e60023] flex items-center justify-center shadow-[0_0_16px_rgba(230,0,35,0.35)]">
            <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.08 3.16 9.42 7.63 11.1-.11-.94-.2-2.39.04-3.42.22-.94 1.43-6.07 1.43-6.07s-.36-.73-.36-1.81c0-1.7 1-2.97 2.25-2.97 1.06 0 1.57.8 1.57 1.75 0 1.07-.68 2.67-1.04 4.15-.29 1.25.63 2.27 1.86 2.27 2.24 0 3.96-2.36 3.96-5.77 0-3.02-2.17-5.13-5.27-5.13-3.59 0-5.7 2.69-5.7 5.47 0 1.08.42 2.25.94 2.88.1.13.12.24.09.37-.1.4-.32 1.3-.36 1.48-.06.24-.19.29-.44.18-1.64-.76-2.67-3.16-2.67-5.08 0-4.14 3.01-7.94 8.68-7.94 4.56 0 8.1 3.25 8.1 7.59 0 4.53-2.86 8.17-6.82 8.17-1.33 0-2.58-.69-3.01-1.51l-.82 3.12c-.3 1.15-1.11 2.59-1.65 3.47 1.25.38 2.58.59 3.96.59 6.63 0 12-5.37 12-12S18.63 0 12 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">PinDrop</h1>
            <p className="text-[11px] text-gray-400">Media Downloader (Pinterest & Instagram)</p>
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
                <div className="w-8 h-8 rounded-full bg-[#e60023] flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(230,0,35,0.3)]">
                  <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.08 3.16 9.42 7.63 11.1-.11-.94-.2-2.39.04-3.42.22-.94 1.43-6.07 1.43-6.07s-.36-.73-.36-1.81c0-1.7 1-2.97 2.25-2.97 1.06 0 1.57.8 1.57 1.75 0 1.07-.68 2.67-1.04 4.15-.29 1.25.63 2.27 1.86 2.27 2.24 0 3.96-2.36 3.96-5.77 0-3.02-2.17-5.13-5.27-5.13-3.59 0-5.7 2.69-5.7 5.47 0 1.08.42 2.25.94 2.88.1.13.12.24.09.37-.1.4-.32 1.3-.36 1.48-.06.24-.19.29-.44.18-1.64-.76-2.67-3.16-2.67-5.08 0-4.14 3.01-7.94 8.68-7.94 4.56 0 8.1 3.25 8.1 7.59 0 4.53-2.86 8.17-6.82 8.17-1.33 0-2.58-.69-3.01-1.51l-.82 3.12c-.3 1.15-1.11 2.59-1.65 3.47 1.25.38 2.58.59 3.96.59 6.63 0 12-5.37 12-12S18.63 0 12 0z" />
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
                    <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-[#e60023] rounded-full animate-spin" />
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
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#e60023] hover:bg-[#ff1a3c] text-white text-xs font-semibold rounded-lg transition"
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
            className="flex items-center gap-2 bg-[#12141c] border border-white/10 focus-within:border-[#e60023] focus-within:ring-2 focus-within:ring-[#e60023]/25 rounded-2xl px-3 py-1.5 transition"
          >
            <label htmlFor="pinterest-url-input" className="sr-only">
              Media URL
            </label>
            <input
              ref={inputRef}
              id="pinterest-url-input"
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste Pinterest (pin.it) or Instagram (reel/post) link..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-gray-100 placeholder:text-gray-500 px-2 py-1.5"
              autoComplete="off"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!inputUrl.trim() || isLoading}
              aria-label="Send link"
              className="w-8 h-8 rounded-full bg-[#e60023] hover:bg-[#ff1a3c] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white transition flex-shrink-0 cursor-pointer"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
          <p className="text-center text-[11px] text-gray-500 mt-2">
            Press Enter to submit • Media saves to <code className="text-gray-400">Downloaded_Pins/</code>
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
        className={`fixed top-0 right-0 w-80 max-w-[85vw] h-full bg-[#12141c] border-l border-white/10 z-50 flex flex-col transition-transform duration-300 ease-out ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-100">Downloaded Pins</h2>
          <button
            onClick={() => setIsDrawerOpen(false)}
            className="text-gray-400 hover:text-gray-200 text-lg p-1 cursor-pointer"
            aria-label="Close drawer"
          >
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
          {history.length === 0 ? (
            <div className="text-center py-10 text-xs text-gray-500">No downloads yet.</div>
          ) : (
            history.map((item, idx) => (
              <div
                key={idx}
                className="bg-[#1a1e29] border border-white/5 rounded-lg p-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-200 truncate">{item.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                    {item.size} • {item.mediaType.toUpperCase()}
                  </div>
                </div>
                <a
                  href={item.url}
                  download={item.name}
                  className="px-2.5 py-1 bg-[#e60023] hover:bg-[#ff1a3c] text-white text-[11px] font-medium rounded transition flex-shrink-0"
                >
                  Save
                </a>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
