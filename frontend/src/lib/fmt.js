export const inr = (v, dec = 0) => {
  if (v === "••••") return v;
  if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "-";
  return "₹ " + Number(v).toLocaleString("en-IN", { maximumFractionDigits: dec, minimumFractionDigits: dec });
};
export const numf = (v, dec = 2) => (v === "••••" ? v : v === null || v === undefined || v === "" ? "-" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: dec }));
export const dmy = (d) => {
  if (!d || typeof d !== "string" || d.length < 10) return d || "-";
  return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const crore = (v) => (v ? `₹ ${(Number(v) / 1e7).toFixed(2)} Cr` : "₹ 0");

export const PRESETS = {
  "ocean-instinct": { name: "Ocean Instinct", primary: "#20309A", surface: "#FFFFFF", accent: "#BB232B" },
  "flora-verse": { name: "Flora Verse", primary: "#9B7ED6", surface: "#F3E6D7", accent: "#E4FF3B" },
  "beyond-limits": { name: "Beyond Limits", primary: "#17191C", surface: "#929DA7", accent: "#FF4B32" },
  "impact-dark": { name: "Impact Dark", primary: "#1C1D20", surface: "#F2F4F1", accent: "#FFC928" },
  "higher-perspective": { name: "Higher Perspective", primary: "#0B3048", surface: "#F2F0E9", accent: "#B9F12F" },
  "modern-living": { name: "Modern Living", primary: "#8DB9F0", surface: "#E9E8F8", accent: "#F5B69E" },
};

const lum = (hex) => {
  const h = (hex || "#000000").replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.substr(i, 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
export const fgFor = (hex) => (contrast(hex, "#FFFFFF") >= 3 ? "#FFFFFF" : "#0B1220");

const toHsl = (hex) => {
  const h = hex.replace("#", "");
  let r = parseInt(h.substr(0, 2), 16) / 255, g = parseInt(h.substr(2, 2), 16) / 255, b = parseInt(h.substr(4, 2), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh /= 6;
  }
  return `${Math.round(hh * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

export function applyTheme(theme) {
  const t = theme || PRESETS["ocean-instinct"];
  const root = document.documentElement.style;
  root.setProperty("--brand-primary", t.primary);
  root.setProperty("--brand-surface", t.surface);
  root.setProperty("--brand-accent", t.accent);
  root.setProperty("--brand-primary-fg", fgFor(t.primary));
  root.setProperty("--brand-accent-fg", fgFor(t.accent));
  // buttons: if primary too light, use dark text (contrast guard)
  root.setProperty("--primary", toHsl(t.primary));
  root.setProperty("--primary-foreground", fgFor(t.primary) === "#FFFFFF" ? "0 0% 100%" : "222 47% 8%");
  root.setProperty("--ring", toHsl(t.primary));
}
