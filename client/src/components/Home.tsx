/**
 * client/src/components/Home.tsx — import controls plus the saved library.
 */

import React, { useState, useRef } from "react";
import type { Entry } from "../lib/storage";
import { countAll, countSteps } from "../../../shared/amounts";

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

      <div className="rd-lib-head">
        <h2 className="rd-lib-title">Saved</h2>
        <span className="rd-lib-count">
          {library.length} {library.length === 1 ? "recipe" : "recipes"}
        </span>
      </div>

      {library.length === 0 ? (
        <div className="rd-empty">
          Nothing saved yet. Anything you diagram lands here, with your progress
          kept.
        </div>
      ) : (
        <div className="rd-grid">
          {library.map((entry) => {
            const total = countAll(entry.recipe);
            const doneN = (entry.done || []).length;
            const pct = total ? Math.round((doneN / total) * 100) : 0;
            return (
              <button
                key={entry.id}
                className="rd-card"
                onClick={() => onOpen(entry.id)}
              >
                <span className="rd-card-title">{entry.recipe.title}</span>
                <span className="rd-card-meta">
                  {entry.recipe.sections.length}{" "}
                  {entry.recipe.sections.length === 1 ? "part" : "parts"} &middot;{" "}
                  {countSteps(entry.recipe)} steps
                  {entry.recipe.source ? ` \u00b7 ${entry.recipe.source}` : ""}
                </span>
                <span className="rd-card-bar">
                  <span className="rd-card-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="rd-card-pct">
                  {pct === 0 ? "Not started" : pct === 100 ? "Done" : `${pct}%`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
