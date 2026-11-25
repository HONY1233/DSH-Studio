import { version as reactVersion } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserLink, SafeExternalLink } from "../src/browser/browserLinks";

const root = createRoot(document.getElementById("root")!);

flushSync(() => {
  root.render(
    <>
      <SafeExternalLink className="safe-probe" href="https://example.com/react-safe">
        React safe link
      </SafeExternalLink>
      <BrowserLink href="mailto:react@example.com?subject=DSH%20Studio">
        <span className="mailto-probe">React mailto link</span>
      </BrowserLink>
      <SafeExternalLink className="bad-probe" href="javascript:alert(1)">
        React unsafe link
      </SafeExternalLink>
      <SafeExternalLink
        className="custom-probe"
        href="https://example.com/react-custom"
        onClick={event => {
          event.preventDefault();
          globalThis.__linkProbe.customPrevented = true;
        }}
      >
        React caller-controlled link
      </SafeExternalLink>
    </>,
  );
});

globalThis.__linkProbe = {
  reactVersion,
  customPrevented: false,
  clicks: {},
};

for (const [key, selector] of [
  ["safe", ".safe-probe"],
  ["mailto", ".mailto-probe"],
  ["bad", ".bad-probe"],
  ["custom", ".custom-probe"],
]) {
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || !event.target.closest(selector)) return;
    globalThis.__linkProbe.clicks[key] = { trusted: event.isTrusted };
  }, true);
}

globalThis.__linkProbe.ready = true;
