import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AlgoPilot · 独立思考的训练伙伴",
    template: "%s · AlgoPilot",
  },
  description:
    "面向 Codeforces / XCPC 个人选手的算法竞赛训练助手。记录思路、分级引导、复盘成长。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
