import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine } from "lucide-react";
import "./_group.css";

const PASTED_TEXT =
  "2 1/2 lb cream cheese\n1 3/4 cup sugar\n1/4 cup cornstarch\n1 1/2 tsp vanilla\n4 eggs\n1/3 cup heavy cream\n\nHeat oven to 350\u00b0F. Beat cream cheese until smooth\u2026";

const CHIPS = ["cream cheese", "sugar", "cornstarch", "vanilla", "eggs", "heavy cream"];

const STATUSES = ["Reading ingredients\u2026", "Finding the steps\u2026", "Building the diagram\u2026"];

export function RecipeScan() {
  const [visibleChips, setVisibleChips] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const chipId = setInterval(() => {
      setVisibleChips((n) => (n < CHIPS.length ? n + 1 : 0));
    }, 550);
    const statusId = setInterval(() => {
      setStatusIndex((i) => (i + 1) % STATUSES.length);
    }, 1650);
    return () => {
      clearInterval(chipId);
      clearInterval(statusId);
    };
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
            <span className="rd-mock-tab">Link</span>
            <span className="rd-mock-tab is-on">Paste text</span>
            <span className="rd-mock-tab">Photo</span>
          </div>

          <div
            style={{
              position: "relative",
              width: "100%",
              minHeight: 150,
              fontSize: 13,
              lineHeight: 1.6,
              padding: "12px 13px",
              border: "1px solid #e4d6b8",
              borderRadius: 9,
              background: "#fffcf3",
              color: "#948b7d",
              whiteSpace: "pre-wrap",
              overflow: "hidden",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {PASTED_TEXT}

            {/* scan beam sweeping down the pasted text, like a knife/scanner reading it */}
            <motion.div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                height: 26,
                background:
                  "linear-gradient(180deg, rgba(200,54,43,0) 0%, rgba(200,54,43,.16) 50%, rgba(200,54,43,0) 100%)",
                borderTop: "1px solid rgba(200,54,43,.55)",
                borderBottom: "1px solid rgba(200,54,43,.55)",
              }}
              initial={{ top: -26 }}
              animate={{ top: [-26, 150] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              style={{ position: "absolute", right: 10, color: "#c8362b" }}
              initial={{ top: -14 }}
              animate={{ top: [-14, 162] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
            >
              <ScanLine size={16} />
            </motion.div>
          </div>

          {/* extracted ingredient chips pop up one at a time, showing the app "understanding" the paste */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, minHeight: 26 }}>
            <AnimatePresence>
              {CHIPS.slice(0, visibleChips).map((chip) => (
                <motion.span
                  key={chip}
                  initial={{ opacity: 0, scale: 0.7, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "4px 10px",
                    borderRadius: 99,
                    background: "#e7ecd5",
                    color: "#445a2e",
                    border: "1px solid #c9dba0",
                  }}
                >
                  {chip}
                </motion.span>
              ))}
            </AnimatePresence>
          </div>

          <AnimatePresence mode="wait">
            <motion.p
              key={statusIndex}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{ margin: "10px 2px 0", fontSize: 12.5, fontWeight: 600, color: "#211d18" }}
            >
              {STATUSES[statusIndex]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default RecipeScan;
