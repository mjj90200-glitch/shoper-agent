/**
 * Tailwind CSS 主题配置
 * 定义前端项目的字体、颜色和阴影扩展
 */
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          '"Noto Sans SC"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
        mono: ['"JetBrains Mono"', '"SFMono-Regular"', "Consolas", "monospace"],
      },
      colors: {
        parchment: "#f4f7fb",
        ink: "#111827",
        soot: "#0b1220",
        moss: "#1688f8",
        brass: "#06b6d4",
        tomato: "#ef4444",
        mist: "#dbe7f3",
      },
      boxShadow: {
        line: "0 1px 2px rgba(15, 23, 42, 0.06)",
        panel: "0 20px 60px rgba(15, 23, 42, 0.14)",
      },
    },
  },
  plugins: [],
} satisfies Config;
