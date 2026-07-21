import { useState, useEffect, useRef, useCallback } from "react";
import { askAssistant } from "~/lib/ai-assistant";

// ── Types ──────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface Position {
  x: number;
  y: number;
}

// ── Voice Types ────────────────────────────────────────────────────

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_POSITION: Position = { x: 20, y: 20 };
const ICON_SIZE = 48;
const ICON_SIZE_HOVER = 56;
const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 480;
const STORAGE_KEY = "hsmc-assistant-position";

// ── Helpers ────────────────────────────────────────────────────────

function getVisiblePageContent(): string {
  try {
    // Get text from main content area, excluding nav/footer/scripts
    const main = document.querySelector("main");
    if (main) {
      const text = main.textContent ?? "";
      return text.replace(/\s+/g, " ").trim().slice(0, 500);
    }
    const body = document.body.textContent ?? "";
    return body.replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    return "";
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadPosition(): Position {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        parsed.x >= 0 &&
        parsed.y >= 0
      ) {
        return parsed;
      }
    }
    return { ...DEFAULT_POSITION };
  } catch {
    return { ...DEFAULT_POSITION };
  }
}

function savePosition(pos: Position) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // localStorage unavailable
  }
}

function clampPosition(pos: Position, viewportW: number, viewportH: number): Position {
  return {
    x: Math.max(0, Math.min(pos.x, viewportW - ICON_SIZE)),
    y: Math.max(0, Math.min(pos.y, viewportH - ICON_SIZE)),
  };
}

// ── Component ──────────────────────────────────────────────────────

export default function FloatingAIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Salut! 👋 Sunt asistentul HSMC. Cu ce te pot ajuta?",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState<Position>(loadPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Position>({ x: 0, y: 0 });
  const [iconHovered, setIconHovered] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  const iconRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // ── Scroll to bottom on new messages ────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Close on Escape ─────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // ── Close on outside click ──────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        iconRef.current &&
        !iconRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    // Delay to avoid the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  // ── Drag handlers ───────────────────────────────────────────────

  const handleDragStart = useCallback(
    (clientX: number, clientY: number) => {
      setIsDragging(true);
      setDragStart({
        x: clientX - position.x,
        y: clientY - position.y,
      });
    },
    [position],
  );

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging) return;
      const newPos = clampPosition(
        {
          x: clientX - dragStart.x,
          y: clientY - dragStart.y,
        },
        window.innerWidth,
        window.innerHeight,
      );
      setPosition(newPos);
    },
    [isDragging, dragStart],
  );

  const handleDragEnd = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      savePosition(position);
    }
  }, [isDragging, position]);

  // Mouse events
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleDragStart(e.clientX, e.clientY);
    },
    [handleDragStart],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => handleDragMove(e.clientX, e.clientY);
    const onUp = () => handleDragEnd();
    if (isDragging) {
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Touch events
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      handleDragStart(touch.clientX, touch.clientY);
    },
    [handleDragStart],
  );

  useEffect(() => {
    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      handleDragMove(touch.clientX, touch.clientY);
    };
    const onUp = () => handleDragEnd();
    if (isDragging) {
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
    }
    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // ── AI Send ─────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;
      const trimmed = text.trim();

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      const pageContext = {
        route: window.location.pathname,
        title: document.title,
        visibleText: getVisiblePageContent(),
      };

      try {
        const history = messages
          .filter((m) => m.id !== "welcome")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const result = await askAssistant({
          message: trimmed,
          history,
          pageContext,
        });

        const aiMsg: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: result.content,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, aiMsg]);
      } catch {
        const errMsg: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: "Eroare de rețea. Verifică conexiunea și încearcă din nou.",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, messages],
  );

  // ── Voice Input ─────────────────────────────────────────────────

  const startListening = useCallback(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      alert("Speech Recognition nu este suportat de acest browser.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "ro-RO";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setInput(transcript);
        // Auto-send
        setTimeout(() => sendMessage(transcript), 200);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("[Voice] Recognition error:", event.error, event.message);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [sendMessage]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.abort();
    setListening(false);
  }, []);

  // ── Voice Output ────────────────────────────────────────────────

  const speakMessage = useCallback((text: string, msgId: string) => {
    if (!("speechSynthesis" in window)) return;

    // If already speaking this message, stop it
    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }

    // Cancel any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ro-RO";
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;

    // Try to find a Romanian voice
    const voices = window.speechSynthesis.getVoices();
    const roVoice = voices.find(
      (v) => v.lang.startsWith("ro") || v.lang === "ro-RO",
    );
    if (roVoice) {
      utterance.voice = roVoice;
    }

    utterance.onstart = () => setSpeakingMsgId(msgId);
    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);

    // Load voices if needed (Chrome async loading)
    if (voices.length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        const updatedVoices = window.speechSynthesis.getVoices();
        const updatedRoVoice = updatedVoices.find(
          (v) => v.lang.startsWith("ro") || v.lang === "ro-RO",
        );
        if (updatedRoVoice) utterance.voice = updatedRoVoice;
        window.speechSynthesis.speak(utterance);
      };
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }, [speakingMsgId]);

  // ── Handle form submit ──────────────────────────────────────────

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [sendMessage, input],
  );

  // ── Panel position calc ─────────────────────────────────────────

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 9998,
  };

  // Position panel above icon if there's room, otherwise below
  const spaceAbove = position.y;
  const panelYPadding = 16;
  if (spaceAbove > PANEL_HEIGHT + panelYPadding) {
    // Above
    panelStyle.bottom = `${window.innerHeight - position.y + panelYPadding}px`;
  } else {
    // Below
    panelStyle.top = `${position.y + ICON_SIZE + panelYPadding}px`;
  }

  // Center horizontally, but stay in viewport
  const panelLeft = position.x + ICON_SIZE / 2 - PANEL_WIDTH / 2;
  const clampedLeft = Math.max(
    8,
    Math.min(panelLeft, window.innerWidth - PANEL_WIDTH - 8),
  );
  panelStyle.left = `${clampedLeft}px`;

  // ── Mobile responsive ───────────────────────────────────────────

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (isMobile && open) {
    panelStyle.left = "5%";
    panelStyle.right = "5%";
    panelStyle.width = "90%";
    panelStyle.maxWidth = `${PANEL_WIDTH}px`;
    panelStyle.marginLeft = "auto";
    panelStyle.marginRight = "auto";
  }

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      {/* Floating Icon */}
      <div
        ref={iconRef}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onMouseEnter={() => setIconHovered(true)}
        onMouseLeave={() => setIconHovered(false)}
        onClick={() => {
          if (!isDragging) setOpen((prev) => !prev);
        }}
        className="fixed z-[9999] flex items-center justify-center rounded-full cursor-grab active:cursor-grabbing select-none"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${iconHovered ? ICON_SIZE_HOVER : ICON_SIZE}px`,
          height: `${iconHovered ? ICON_SIZE_HOVER : ICON_SIZE}px`,
          background: "rgba(8, 10, 15, 0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(0, 188, 212, 0.3)",
          boxShadow: iconHovered
            ? "0 0 20px rgba(0, 188, 212, 0.3), 0 0 40px rgba(0, 188, 212, 0.1), 0 4px 16px rgba(0, 0, 0, 0.5)"
            : "0 0 12px rgba(0, 188, 212, 0.15), 0 4px 12px rgba(0, 0, 0, 0.4)",
          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: iconHovered ? "scale(1.05)" : "scale(1)",
        }}
        title="HSMC Assistant — Click to chat"
        role="button"
        aria-label="Open HSMC AI Assistant"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
      >
        {/* Pulsing glow ring */}
        <div
          className="absolute inset-0 rounded-full animate-pulse-slow pointer-events-none"
          style={{
            border: "2px solid rgba(0, 188, 212, 0.2)",
            animation: "pulse-slow 3s ease-in-out infinite",
          }}
        />

        {/* Diamond icon */}
        <span
          className="text-2xl select-none"
          style={{
            filter: iconHovered
              ? "drop-shadow(0 0 8px rgba(0, 188, 212, 0.6))"
              : "drop-shadow(0 0 4px rgba(0, 188, 212, 0.3))",
            transition: "filter 0.25s ease",
          }}
        >
          💎
        </span>
      </div>

      {/* Chat Panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed z-[9998] flex flex-col overflow-hidden"
          style={{
            ...panelStyle,
            width: isMobile ? undefined : `${PANEL_WIDTH}px`,
            height: `${PANEL_HEIGHT}px`,
            background: "rgba(8, 10, 15, 0.92)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(0, 188, 212, 0.2)",
            borderRadius: "16px",
            boxShadow:
              "0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 188, 212, 0.05)",
            animation: "fade-in-up 0.3s ease-out both",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{
              borderBottom: "1px solid rgba(0, 188, 212, 0.12)",
              background: "rgba(0, 188, 212, 0.03)",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">💎</span>
              <span
                className="text-sm font-semibold tracking-wide"
                style={{
                  color: "#e0e6ed",
                  fontFamily: "Inter, sans-serif",
                }}
              >
                HSMC Assistant
              </span>
              <span
                className="text-[0.6rem] px-1.5 py-0.5 rounded font-mono"
                style={{
                  background: "rgba(0, 188, 212, 0.12)",
                  color: "#00bcd4",
                }}
              >
                AI
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg transition-colors hover:bg-[rgba(255,255,255,0.05)]"
              style={{ color: "#546e7a" }}
              aria-label="Close assistant"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
            style={{ scrollBehavior: "smooth" }}
          >
            {messages.map((msg, i) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                style={{
                  animation: `fade-in-up 0.3s ease-out ${i === messages.length - 1 ? "both" : "both"}`,
                }}
              >
                <div
                  className="relative max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed"
                  style={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: "14px",
                    lineHeight: "1.5",
                    ...(msg.role === "user"
                      ? {
                          background: "rgba(0, 188, 212, 0.15)",
                          border: "1px solid rgba(0, 188, 212, 0.2)",
                          borderBottomRightRadius: "6px",
                          color: "#e0e6ed",
                        }
                      : {
                          background: "rgba(255, 255, 255, 0.04)",
                          border: "1px solid rgba(255, 255, 255, 0.06)",
                          borderBottomLeftRadius: "6px",
                          color: "#b0bec5",
                        }),
                  }}
                >
                  {msg.role === "assistant" && msg.id === messages[messages.length - 1]?.id && isLoading ? (
                    <div className="flex items-center gap-1.5 py-1">
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{
                          background: "#00bcd4",
                          animationDelay: "0ms",
                        }}
                      />
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{
                          background: "#00bcd4",
                          animationDelay: "150ms",
                        }}
                      />
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{
                          background: "#00bcd4",
                          animationDelay: "300ms",
                        }}
                      />
                    </div>
                  ) : (
                    <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                  )}

                  {/* Speaker button for assistant messages */}
                  {msg.role === "assistant" && msg.id !== "welcome" && !isLoading && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        speakMessage(msg.content, msg.id);
                      }}
                      className="block mt-1.5 text-xs transition-colors hover:opacity-80"
                      style={{
                        color: speakingMsgId === msg.id ? "#00e676" : "#546e7a",
                      }}
                      title={speakingMsgId === msg.id ? "Stop" : "Ascultă răspunsul"}
                    >
                      {speakingMsgId === msg.id ? "🔊" : "🔈"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer — Input + Mic */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-3 py-3 shrink-0"
            style={{
              borderTop: "1px solid rgba(0, 188, 212, 0.12)",
              background: "rgba(0, 0, 0, 0.15)",
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Scrie un mesaj..."
              disabled={isLoading}
              className="flex-1 px-3 py-2 rounded-xl text-sm transition-all outline-none disabled:opacity-40"
              style={{
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                color: "#e0e6ed",
                fontFamily: "Inter, sans-serif",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "rgba(0, 188, 212, 0.4)";
                e.target.style.boxShadow = "0 0 8px rgba(0, 188, 212, 0.1)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "rgba(255, 255, 255, 0.08)";
                e.target.style.boxShadow = "none";
              }}
            />

            {/* Mic button */}
            <button
              type="button"
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onMouseLeave={stopListening}
              onTouchStart={startListening}
              onTouchEnd={stopListening}
              className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-all ${
                listening ? "animate-pulse" : ""
              }`}
              style={{
                background: listening
                  ? "rgba(0, 230, 118, 0.2)"
                  : "rgba(255, 255, 255, 0.05)",
                border: `1px solid ${
                  listening
                    ? "rgba(0, 230, 118, 0.4)"
                    : "rgba(255, 255, 255, 0.1)"
                }`,
                boxShadow: listening
                  ? "0 0 16px rgba(0, 230, 118, 0.3)"
                  : "none",
              }}
              title="Ține apăsat pentru a vorbi"
              aria-label="Voice input"
            >
              <span style={{ fontSize: "16px" }}>🎤</span>
            </button>

            {/* Send button */}
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-all disabled:opacity-30"
              style={{
                background: input.trim()
                  ? "rgba(0, 188, 212, 0.2)"
                  : "rgba(255, 255, 255, 0.05)",
                border: `1px solid ${
                  input.trim()
                    ? "rgba(0, 188, 212, 0.3)"
                    : "rgba(255, 255, 255, 0.08)"
                }`,
              }}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
