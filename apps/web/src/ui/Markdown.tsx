import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownProps = {
  content: string;
  className?: string;
};

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <ReactMarkdown className={className} remarkPlugins={[remarkGfm]}>
      {content}
    </ReactMarkdown>
  );
}

