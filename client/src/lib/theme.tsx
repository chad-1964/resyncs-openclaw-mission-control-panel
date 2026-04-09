import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
type ColorScheme = "default" | "ocean" | "midnight" | "forest" | "slate" | "amber";

interface ThemeContextType {
  theme: Theme;
  colorScheme: ColorScheme;
  toggleTheme: () => void;
  setColorScheme: (scheme: ColorScheme) => void;
}

export const COLOR_SCHEMES: { id: ColorScheme; label: string; preview: string; accent: string }[] = [
  { id: "default", label: "Teal",     preview: "hsl(173, 58%, 44%)", accent: "#0d9488" },
  { id: "ocean",   label: "Ocean",    preview: "hsl(221, 83%, 53%)", accent: "#3b82f6" },
  { id: "midnight",label: "Midnight", preview: "hsl(262, 83%, 58%)", accent: "#8b5cf6" },
  { id: "forest",  label: "Forest",   preview: "hsl(142, 71%, 45%)", accent: "#22c55e" },
  { id: "slate",   label: "Slate",    preview: "hsl(215, 20%, 65%)", accent: "#94a3b8" },
  { id: "amber",   label: "Amber",    preview: "hsl(38, 92%, 50%)",  accent: "#f59e0b" },
];

// CSS variable overrides for each color scheme (dark mode only — light mode stays default)
const SCHEME_VARS: Record<ColorScheme, Record<string, string>> = {
  default: {}, // uses the CSS defaults (teal)
  ocean: {
    "--primary": "221 83% 53%",
    "--primary-foreground": "0 0% 100%",
    "--sidebar-primary": "221 83% 53%",
  },
  midnight: {
    "--primary": "262 83% 58%",
    "--primary-foreground": "0 0% 100%",
    "--sidebar-primary": "262 83% 58%",
  },
  forest: {
    "--primary": "142 71% 45%",
    "--primary-foreground": "0 0% 100%",
    "--sidebar-primary": "142 71% 45%",
  },
  slate: {
    "--primary": "215 20% 65%",
    "--primary-foreground": "220 16% 7%",
    "--sidebar-primary": "215 20% 65%",
  },
  amber: {
    "--primary": "38 92% 50%",
    "--primary-foreground": "220 16% 7%",
    "--sidebar-primary": "38 92% 50%",
  },
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  colorScheme: "default",
  toggleTheme: () => {},
  setColorScheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [colorScheme, setColorScheme] = useState<ColorScheme>("default");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Apply color scheme CSS variables
  useEffect(() => {
    const vars = SCHEME_VARS[colorScheme] || {};
    const root = document.documentElement;

    // Reset to defaults first (remove any previously set vars)
    for (const scheme of Object.values(SCHEME_VARS)) {
      for (const key of Object.keys(scheme)) {
        root.style.removeProperty(key);
      }
    }

    // Apply new scheme
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
  }, [colorScheme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, colorScheme, toggleTheme, setColorScheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
