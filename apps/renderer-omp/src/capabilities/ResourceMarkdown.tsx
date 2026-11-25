import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightedCode } from "../highlight/HighlightedCode";
import { normalizeExternalUrl, normalizeMailtoUrl } from "../browser/urlSafety";

/** Session resources have no workspace base path. Relative references stay in the document. */
const components: Components = {
  a: ({ href, children }) => {
    const raw = href ?? "", safeHref = normalizeExternalUrl(raw) ?? normalizeMailtoUrl(raw);
    return safeHref !== null ? <a href={safeHref} target="_blank" rel="noreferrer noopener">{children}</a> : <span title={raw}>{children}</span>;
  },
  img: ({ src, alt }) => {
    const safeSrc = normalizeExternalUrl(src);
    return safeSrc !== null ? <img src={safeSrc} alt={alt ?? ""} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="file-muted">{alt || src}</span>;
  },
  pre: ({ children }) => <pre className="codeblock md-code-pre">{children}</pre>,
  code: ({ className, children }) => {
    const language = /(?:^|\s)language-(\S+)/.exec(className ?? "")?.[1];
    return language && typeof children === "string" ? <HighlightedCode language={language} code={children} /> : <code>{children}</code>;
  },
};
export default memo(function ResourceMarkdown({ text }: { text: string }) {
  return <div className="convo-md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown></div>;
});
