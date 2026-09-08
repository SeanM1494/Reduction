import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, ChefHat, Soup, UtensilsCrossed, Sparkles } from "lucide-react";
import "./_group.css";

const STEPS: Array<{ icon: typeof Flame; label: string }> = [
  { icon: ChefHat, label: "Reading the recipe" },
  { icon: UtensilsCrossed, label: "Sorting ingredients" },
  { icon: Soup, label: "Mapping what mixes with what" },
  { icon: Sparkles, label: "Plating the diagram" },
];

export function SizzlingTicker() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1500);
    return () => clearInterval(id);
  }, []);

  const Icon = STEPS[step].icon;

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

          {/* the url row stays put, just dimmed/disabled, matching current behavior */}
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 15,
                padding: "12px 13px",
                border: "1px solid #e4d6b8",
                borderRadius: 9,
                background: "#f7f0df",
                color: "#948b7d",
              }}
            >
              cookingforengineers.com/recipe/1223
            </div>

            {/* the sizzle strip replaces the button */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 16px",
                borderRadius: 9,
                background: "#211d18",
                color: "#fffcf3",
                minWidth: 168,
                overflow: "hidden",
              }}
            >
              {/* little spark particles behind the flame */}
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  style={{
                    position: "absolute",
                    left: 22 + i * 3,
                    bottom: 10,
                    width: 3,
                    height: 3,
                    borderRadius: "50%",
                    background: "#f7dad5",
                  }}
                  initial={{ opacity: 0, y: 0 }}
                  animate={{ opacity: [0, 1, 0], y: [0, -16] }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.35, ease: "easeOut" }}
                />
              ))}

              <motion.span
                style={{ display: "flex" }}
                animate={{ rotate: [0, -8, 8, -4, 0], scale: [1, 1.08, 1] }}
                transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
              >
                <Flame size={18} color="#f0a24a" fill="#f0a24a" />
              </motion.span>

              <AnimatePresence mode="wait">
                <motion.span
                  key={step}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.25 }}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}
                >
                  <Icon size={13} />
                  {STEPS[step].label}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          {/* thin indeterminate progress line under the whole row */}
          <div
            style={{
              marginTop: 10,
              height: 3,
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
                width: "36%",
              }}
              animate={{ x: ["-40%", "280%"] }}
              transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default SizzlingTicker;
