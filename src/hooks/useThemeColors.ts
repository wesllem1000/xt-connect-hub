import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Convert hex (#rrggbb) to HSL { h, s, l }
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Convert HSL to hex
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Derive all theme variables from a single primary HSL
function deriveThemeColors(h: number, s: number, l: number) {
  return {
    "--primary": `${h} ${s}% ${l}%`,
    "--primary-glow": `${(h + 6) % 360} ${Math.min(s + 6, 100)}% ${Math.min(l + 8, 100)}%`,
    "--primary-dark": `${(h - 6 + 360) % 360} ${Math.max(s - 4, 0)}% ${Math.max(l - 8, 10)}%`,
    // Light mode accent
    "--accent-light": `${h} ${Math.max(s - 12, 20)}% 95%`,
    "--accent-foreground-light": `${h} ${s}% ${l}%`,
    // Dark mode accent
    "--accent-dark": `${h} ${Math.max(s - 32, 10)}% 15%`,
    "--accent-foreground-dark": `${h} ${s}% ${Math.min(l + 15, 70)}%`,
    // Ring
    "--ring": `${h} ${s}% ${l}%`,
    // Sidebar
    "--sidebar-primary": `${h} ${s}% ${l}%`,
    "--sidebar-ring": `${h} ${s}% ${l}%`,
    // Sidebar accent (dark)
    "--sidebar-accent-dark": `${h} ${Math.max(s - 32, 10)}% 15%`,
    "--sidebar-accent-foreground-dark": `${h} ${s}% ${Math.min(l + 15, 70)}%`,
    // Charts
    "--chart-1": `${h} ${s}% ${l}%`,
    "--chart-2": `${(h + 6) % 360} ${Math.min(s + 6, 100)}% ${Math.min(l + 8, 100)}%`,
    "--chart-3": `${(h + 14) % 360} ${Math.max(s - 7, 30)}% ${Math.min(l + 5, 60)}%`,
    "--chart-4": `${(h - 8 + 360) % 360} ${Math.max(s - 12, 30)}% ${Math.min(l + 10, 65)}%`,
    // Secondary glow
    "--secondary-glow": `${h} ${s}% ${Math.min(l + 8, 100)}%`,
  };
}

function applyThemeToDOM(h: number, s: number, l: number) {
  const colors = deriveThemeColors(h, s, l);
  const root = document.documentElement;

  // Apply shared variables
  root.style.setProperty("--primary", colors["--primary"]);
  root.style.setProperty("--primary-glow", colors["--primary-glow"]);
  root.style.setProperty("--primary-dark", colors["--primary-dark"]);
  root.style.setProperty("--ring", colors["--ring"]);
  root.style.setProperty("--sidebar-primary", colors["--sidebar-primary"]);
  root.style.setProperty("--sidebar-primary-foreground", "0 0% 100%");
  root.style.setProperty("--sidebar-ring", colors["--sidebar-ring"]);
  root.style.setProperty("--chart-1", colors["--chart-1"]);
  root.style.setProperty("--chart-2", colors["--chart-2"]);
  root.style.setProperty("--chart-3", colors["--chart-3"]);
  root.style.setProperty("--chart-4", colors["--chart-4"]);
  root.style.setProperty("--secondary-glow", colors["--secondary-glow"]);

  // Mode-dependent accents: we apply both and let CSS :root/.dark handle it
  // Since inline styles override both, we use a smarter approach:
  // Apply accent based on current theme
  const isDark = root.classList.contains("dark");
  if (isDark) {
    root.style.setProperty("--accent", colors["--accent-dark"]);
    root.style.setProperty("--accent-foreground", colors["--accent-foreground-dark"]);
    root.style.setProperty("--sidebar-accent", colors["--sidebar-accent-dark"]);
    root.style.setProperty("--sidebar-accent-foreground", colors["--sidebar-accent-foreground-dark"]);
  } else {
    root.style.setProperty("--accent", colors["--accent-light"]);
    root.style.setProperty("--accent-foreground", colors["--accent-foreground-light"]);
    root.style.setProperty("--sidebar-accent", "0 0% 32%");
    root.style.setProperty("--sidebar-accent-foreground", "0 0% 98%");
  }
}

// Observe theme class changes to reapply accent colors
function observeThemeChanges(h: number, s: number, l: number) {
  const observer = new MutationObserver(() => {
    applyThemeToDOM(h, s, l);
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return observer;
}

/**
 * Hook that loads the saved theme color from the database and applies it.
 * Should be called once at the App level.
 */
export function useThemeColors() {
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;

    const load = async () => {
      const { data } = await supabase
        .from("system_config")
        .select("valor")
        .eq("chave", "theme_primary_color")
        .maybeSingle();

      if (data?.valor) {
        setPrimaryColor(data.valor);
        const { h, s, l } = hexToHsl(data.valor);
        applyThemeToDOM(h, s, l);
        observer = observeThemeChanges(h, s, l);
      }
    };

    load();

    return () => {
      observer?.disconnect();
    };
  }, []);

  return primaryColor;
}

/**
 * Apply a color immediately (for live preview in the admin panel).
 */
export function applyColorPreview(hex: string) {
  const { h, s, l } = hexToHsl(hex);
  applyThemeToDOM(h, s, l);
}

export { hexToHsl, hslToHex, deriveThemeColors };
