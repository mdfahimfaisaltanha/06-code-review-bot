import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "ReviewBot — CodeAtlas AI Code Review",
  description: "Automated AI-powered code review for GitHub pull requests",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <div className="header-inner">
            <span className="logo">🤖 ReviewBot</span>
            <span className="sub">CodeAtlas • AI Code Review</span>
          </div>
        </header>
        <div className="container">{children}</div>
      </body>
    </html>
  )
}
