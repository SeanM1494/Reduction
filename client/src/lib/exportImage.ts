/**
 * client/src/lib/exportImage.ts — turn the on-screen recipe diagram into a
 * single downloadable PNG.
 *
 * The diagram normally relies on horizontal scrolling (`.rd-frame` is an
 * overflow-x:auto container) to fit wide tables on narrow screens. A static
 * image can't scroll, so before capturing we widen the capture root until
 * every table fits without clipping, then shrink back down to that measured
 * width so the export isn't full of empty margin. Everything is restored
 * afterwards — this never permanently changes the live page.
 */
import { toPng } from "html-to-image";

const EXPORT_BG = "#f0e2c8"; // matches --page
const MAX_WIDTH = 2000; // generous ceiling so one runaway recipe can't hang the tab
const MIN_WIDTH = 380; // roughly a phone screen, so short recipes still look intentional

export async function saveRecipeAsImage(node: HTMLElement, fileName: string) {
  const originalStyle = node.getAttribute("style");
  node.classList.add("is-exporting");

  try {
    // Pass 1: give every table room to lay out at full width, unclipped.
    node.style.width = `${MAX_WIDTH}px`;
    await settle();

    const widest = Math.max(
      MIN_WIDTH,
      ...[...node.querySelectorAll<HTMLElement>(".rd-table")].map(
        (t) => t.scrollWidth
      )
    );
    const targetWidth = Math.min(MAX_WIDTH, widest + 4);

    // Pass 2: shrink to that measured width so the image is a tight fit.
    node.style.width = `${targetWidth}px`;
    await settle();

    const dataUrl = await toPng(node, {
      backgroundColor: EXPORT_BG,
      pixelRatio: 2,
      width: node.scrollWidth,
      height: node.scrollHeight,
    });

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName;
    link.click();
  } finally {
    if (originalStyle === null) node.removeAttribute("style");
    else node.setAttribute("style", originalStyle);
    node.classList.remove("is-exporting");
  }
}

/** Two animation frames: one for the style to apply, one for layout to read back. */
function settle(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

export function slugForFile(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "recipe"}-diagram.png`;
}
