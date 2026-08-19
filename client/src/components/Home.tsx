/**
 * client/src/components/Home.tsx — import controls plus the saved library.
 */

import React, { useState, useRef } from "react";
import type { Entry } from "../lib/storage";
import ExtractionProgress from "./ExtractionProgress";

type Mode = "link" | "paste" | "photo";

interface Props {
  library: Entry[];
  busy: boolean;
  error: string | null;
  onOpen: (id: string) => void;
  onImportUrl: (url: string) => void;
  onImportText: (text: string) => void;
  onImportFile: (file: File) => void;
  onDismissError: () => void;
}

export default function Home({
  library,
  busy,
  error,
  onOpen,
  onImportUrl,
  onImportText,
  onImportFile,
  onDismissError,
}: Props) {
  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const tabs: Array<[Mode, string]> = [
    ["link", "Link"],
    ["paste", "Paste text"],
    ["photo", "Photo"],
  ];

  return (
    <>
      <div className="rd-hero">
        <h1 className="rd-hero-title">Every recipe, as one diagram.</h1>
        <p className="rd-hero-sub">
          Paste a link and get a table that shows what mixes into what &mdash;
          and what you can do right now.
        </p>
      </div>

      <div className="rd-import">
        <div className="rd-tabs" role="tablist">
          {tabs.map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`rd-tab ${mode === m ? "is-on" : ""}`}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "link" ? (
          <div className="rd-urlbar">
            <input
              className="rd-url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/recipe"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim() && !busy)
                  onImportUrl(url.trim());
              }}
              disabled={busy}
            />
            <button
              className="rd-go"
              onClick={() => onImportUrl(url.trim())}
              disabled={busy || !url.trim()}
            >
              {busy ? "Reading\u2026" : "Diagram it"}
            </button>
          </div>
        ) : null}

        {mode === "paste" ? (
          <div className="rd-pastebox">
            <textarea
              className="rd-paste"
              placeholder={
                "Paste the ingredients and instructions.\n\n2 1/2 lb cream cheese\n1 3/4 cup sugar\n\u2026"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
            <button
              className="rd-go"
              onClick={() => onImportText(text.trim())}
              disabled={busy || text.trim().length < 40}
            >
              {busy ? "Reading\u2026" : "Diagram it"}
            </button>
          </div>
        ) : null}

        {mode === "photo" ? (
          <div className="rd-pastebox">
            <p className="rd-photo-note">
              A photo of a cookbook page or a PDF works. No typing needed.
            </p>
            <input
              ref={fileInput}
              className="rd-file"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportFile(f);
                if (fileInput.current) fileInput.current.value = "";
              }}
            />
          </div>
        ) : null}

        {/* One line for all three modes: whichever is open, the wait is the
            same pipeline and the same sequence. */}
        <ExtractionProgress active={busy} />

        {error ? (
          <div className="rd-alert">
            <span>{error}</span>
            <button
              className="rd-alert-x"
              onClick={onDismissError}
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        ) : null}
      </div>

    </>
  );
}
