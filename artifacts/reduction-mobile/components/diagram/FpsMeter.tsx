/**
 * FpsMeter — the spike's on-screen instrument for kill criterion 2.
 *
 * WHAT IT MEASURES, HONESTLY: requestAnimationFrame cadence on the JS
 * thread. Native ScrollView scrolling and the useNativeDriver shadow run on
 * the UI thread, so a perfect JS number does not by itself prove smooth
 * scroll — but a BAD JS number during interaction (measure storms, re-solve
 * churn) is exactly the failure mode this spike exists to catch, and the
 * definitive UI-thread number is one shake away in Expo Go's perf monitor.
 * Read both: this meter for the app's own work, the perf monitor for the
 * compositor.
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function FpsMeter() {
  const [stats, setStats] = useState({ fps: 0, dropped: 0, worst: 0, frames: 0 });
  const state = useRef({ last: 0, deltas: [] as number[], dropped: 0, worst: 0 });

  useEffect(() => {
    let alive = true;
    let raf: number;
    const tick = (t: number) => {
      const s = state.current;
      if (s.last) {
        const d = t - s.last;
        s.deltas.push(d);
        if (d > 20) s.dropped++; // >20ms = missed at least one 60hz frame
        if (d > s.worst) s.worst = d;
        if (s.deltas.length >= 30) {
          const avg = s.deltas.reduce((a, b) => a + b, 0) / s.deltas.length;
          setStats((prev) => ({
            fps: Math.round(1000 / avg),
            dropped: s.dropped,
            worst: Math.round(s.worst),
            frames: prev.frames + s.deltas.length,
          }));
          s.deltas = [];
        }
      }
      s.last = t;
      if (alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <Pressable
      style={styles.box}
      onPress={() => {
        state.current = { last: 0, deltas: [], dropped: 0, worst: 0 };
        setStats({ fps: 0, dropped: 0, worst: 0, frames: 0 });
      }}
    >
      <Text style={styles.text}>
        JS {stats.fps}fps · dropped {stats.dropped} · worst {stats.worst}ms
      </Text>
      <Text style={styles.hint}>tap to reset · UI thread: shake → Perf monitor</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute", top: 4, right: 4, zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  text: { color: "#7CFC9A", fontSize: 12, fontVariant: ["tabular-nums"] },
  hint: { color: "#bbb", fontSize: 9 },
});
