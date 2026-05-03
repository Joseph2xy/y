"use client";

import React, { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type CodeHighlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
};

let highlighterPromise: Promise<CodeHighlighter> | null = null;

function getHighlighter() {
  highlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/github-dark.mjs"),
    import("shiki/langs/sql.mjs"),
    import("shiki/langs/json.mjs"),
    import("shiki/langs/shellscript.mjs")
  ]).then(async ([core, engine, theme, sql, json, shellscript]) => {
    return core.createHighlighterCore({
      themes: [theme.default],
      langs: [sql.default, json.default, shellscript.default],
      engine: engine.createJavaScriptRegexEngine()
    });
  });

  return highlighterPromise;
}

function supportedLanguage(language: string) {
  if (language === "shell" || language === "bash" || language === "sh") return "shellscript";
  if (language === "sql" || language === "json" || language === "shellscript") return language;
  return "shellscript";
}

export type CodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn("not-prose flex w-full flex-col overflow-clip rounded-lg border bg-card text-card-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export type CodeBlockCodeProps = {
  code: string;
  language?: string;
  theme?: string;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

function CodeBlockCode({ code, language = "tsx", theme = "github-dark", className, ...props }: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      if (!code) {
        if (!cancelled) setHighlightedHtml("<pre><code></code></pre>");
        return;
      }

      const highlighter = await getHighlighter();
      const html = highlighter.codeToHtml(code, { lang: supportedLanguage(language), theme });
      if (!cancelled) setHighlightedHtml(html);
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [code, language, theme]);

  const classNames = cn("w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4", className);

  return highlightedHtml ? (
    <div className={classNames} {...props}>
      <span className="sr-only">{code}</span>
      <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
    </div>
  ) : (
    <div className={classNames} {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>;

function CodeBlockGroup({ children, className, ...props }: CodeBlockGroupProps) {
  return (
    <div className={cn("flex items-center justify-between", className)} {...props}>
      {children}
    </div>
  );
}

export { CodeBlock, CodeBlockCode, CodeBlockGroup };
