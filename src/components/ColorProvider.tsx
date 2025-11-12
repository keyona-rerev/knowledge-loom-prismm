import { useEffect } from "react";
import { useUserColors } from "@/hooks/useUserColors";

export const ColorProvider = ({ children }: { children: React.ReactNode }) => {
  const { colors } = useUserColors();

  useEffect(() => {
    // Convert hex to HSL for CSS variables
    const hexToHSL = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!result) return "0 0% 0%";
      
      let r = parseInt(result[1], 16) / 255;
      let g = parseInt(result[2], 16) / 255;
      let b = parseInt(result[3], 16) / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h = 0, s = 0, l = (max + min) / 2;

      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          case b: h = ((r - g) / d + 4) / 6; break;
        }
      }

      return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
    };

    // Apply colors to CSS variables
    const root = document.documentElement;
    root.style.setProperty('--primary', hexToHSL(colors.primary));
    root.style.setProperty('--secondary', hexToHSL(colors.secondary));
    root.style.setProperty('--accent', hexToHSL(colors.accent));
  }, [colors]);

  return <>{children}</>;
};
