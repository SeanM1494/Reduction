import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./_group.css";

const CAPTIONS = [
  "Simmering the ingredients\u2026",
  "Reducing to what matters\u2026",
  "Skimming the steps\u2026",
  "Plating your diagram\u2026",
];

// Deterministic bubble layout so the animation looks intentional, not random noise.
const BUBBLES = [
  { x: 18, size: 5, delay: 0 },
  { x: 34, size: 3.5, delay: 0.4 },
  { x: 50, size: 6, delay: 0.9 },
  { x: 64, size: 4, delay: 0.2 },
  { x: 78, size: 5, delay: 1.3 },
  { x: 26, size: 3, delay: 1.7 },
  { x: 58, size: 3.5, delay: 2.1 },
];

function Pot() {
  return (
    <div style={{ position: "relative", width: 120, height: 104, margin: "0 auto" }}>
      {/* steam */}
      {[0, 1, 2].map((i) => (
        <motion.svg
          key={i}
          width="18"
          height="34"
          viewBox="0 0 18 34"
          style={{ position: "absolute", top: -30, left: 34 + i * 26 }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: [0, 0.55, 0], y: [6, -22] }}
          transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
        >
          <path
            d="M9 32c4-5-4-7 0-12s-4-7 0-12"
            fill="none"
            stroke="#948b7d"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </motion.svg>
      ))}

      {/* pot body */}
      <svg width="120" height="104" viewBox="0 0 120 104">
        <defs>
          <clipPath id="potLiquidClip">
            <path d="M14 34h92l-8 54a10 10 0 0 1-10 8H32a10 10 0 0 1-10-8L14 34z" />
          </clipPath>
        </defs>

        {/* handles */}
        <rect x="0" y="30" width="14" height="10" rx="5" fill="#c8362b" />
        <rect x="106" y="30" width="14" height="10" rx="5" fill="#c8362b" />

        {/* pot silhouette */}
        <path
          d="M14 34h92l-8 54a10 10 0 0 1-10 8H32a10 10 0 0 1-10-8L14 34z"
          fill="#fffcf3"
          stroke="#211d18"
          strokeWidth="3"
        />

        {/* liquid, clipped to the pot's inner shape and animated rising/falling */}
        <g clipPath="url(#potLiquidClip)">
          <motion.rect
            x="10"
            width="100"
            height="70"
            fill="#c8362b"
            initial={{ y: 100 }}
            animate={{ y: [100, 46, 100] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
          {/* bubbles rising inside the liquid */}
          {BUBBLES.map((b, i) => (
            <motion.circle
              key={i}
              cx={b.x}
              r={b.size}
              fill="#f7dad5"
              initial={{ cy: 100, opacity: 0 }}
              animate={{ cy: [100, 40], opacity: [0, 0.9, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: b.delay, ease: "easeOut" }}
            />
          ))}
        </g>

        {/* lid rim */}
        <rect x="10" y="26" width="100" height="10" rx="5" fill="#211d18" />
        <rect x="52" y="14" width="16" height="14" rx="4" fill="#211d18" />
      </svg>
    </div>
  );
}

export function SimmeringPot() {
  const [captionIndex, setCaptionIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCaptionIndex((i) => (i + 1) % CAPTIONS.length);
    }, 1900);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rd-mock rd-root">
      <div className="rd-mock-shell">
        <h1 className="rd-mock-hero-title">Every recipe, as one diagram.</h1>
        <p className="rd-mock-hero-sub">
          Paste a link and get a table that shows what mixes into what &mdash; and what you can do right now.
        </p>

        <div className="rd-mock-import">
          <div className="rd-mock-tabs" role="tablist">
            <span className="rd-mock-tab is-on">Link</span>
            <span className="rd-mock-tab">Paste text</span>
            <span className="rd-mock-tab">Photo</span>
          </div>

          <div style={{ padding: "14px 0 4px" }}>
            <Pot />

            <AnimatePresence mode="wait">
              <motion.p
                key={captionIndex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3 }}
                style={{
                  textAlign: "center",
                  margin: "14px 0 0",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#211d18",
                }}
              >
                {CAPTIONS[captionIndex]}
              </motion.p>
            </AnimatePresence>

            {/* decorative reduction bar — loops to suggest motion, not literal % complete */}
            <div
              style={{
                marginTop: 12,
                height: 5,
                borderRadius: 99,
                background: "#e4d6b8",
                overflow: "hidden",
              }}
            >
              <motion.div
                style={{
                  height: "100%",
                  borderRadius: 99,
                  background: "linear-gradient(90deg, #c8362b, #7c9b54)",
                }}
                initial={{ x: "-40%", width: "40%" }}
                animate={{ x: ["-40%", "140%"] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SimmeringPot;
