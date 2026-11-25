/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { mirrorAppearance } from "./NativeFloat";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.documentElement.removeAttribute("data-preview");
  document.documentElement.removeAttribute("data-preview-marks");
  for (const style of Array.from(document.head.querySelectorAll("[data-preview-test-style]"))) style.remove();
});

it("mirrors preview state into native float documents and keeps an independent CSS mark", async () => {
  const style = document.createElement("style");
  style.setAttribute("data-preview-test-style", "");
  style.textContent = ".float-fixture { color: red; }";
  document.head.append(style);
  document.documentElement.setAttribute("data-preview", "on");
  document.documentElement.setAttribute("data-preview-marks", "on");
  const target = document.implementation.createHTMLDocument("float");
  dispose = mirrorAppearance(target);

  expect(target.documentElement.getAttribute("data-preview-dom")).toBe("float");
  expect(target.documentElement.getAttribute("data-preview")).toBe("on");
  expect(target.documentElement.getAttribute("data-preview-marks")).toBe("on");
  expect(target.head.querySelector("style")?.textContent).toBe(".float-fixture { color: red; }");
  const css = readFileSync("src/styles/base.css", "utf8");
  expect(css).toContain('html[data-preview-dom="float"][data-preview="on"][data-preview-marks="on"]::after');
  expect(css).toContain('content: "PREVIEW · Preview fixtures"');

  document.documentElement.setAttribute("data-preview", "off");
  document.documentElement.setAttribute("data-preview-marks", "off");
  await waitFor(() => expect(target.documentElement.getAttribute("data-preview")).toBe("off"));
  expect(target.documentElement.getAttribute("data-preview-marks")).toBe("off");
  expect(target.documentElement.getAttribute("data-preview-dom")).toBe("float");
});
