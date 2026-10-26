// @vitest-environment happy-dom

import { defaultExportConfig } from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import { fitDocumentImagesToPage } from "../src/document-image-fit.js";

describe("Markdown 图片单页适配", () => {
  it("标记独立图片段落并将超高图片缩放到单页", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p> <img class="md-document-image" src="data:image/png;base64,AA=="> </p>';
    const image = root.querySelector("img")!;
    Object.defineProperties(image, {
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 3000 }
    });

    fitDocumentImagesToPage(root, defaultExportConfig);

    expect(image.parentElement?.classList).toContain(
      "md-document-image-block"
    );
    expect(image.dataset.pageHeightFitted).toBe("true");
    expect(image.parentElement?.dataset.pageHeightFitted).toBe("true");
    expect(
      image.parentElement?.style.getPropertyValue("margin-block")
    ).toBe("0");
    expect(Number.parseFloat(image.style.height)).toBeCloseTo(
      1000.5748,
      3
    );
    expect(Number.parseFloat(image.style.width)).toBeCloseTo(
      333.5249,
      3
    );
  });

  it("普通横图保持主题控制的尺寸", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p><img class="md-document-image" src="data:image/png;base64,AA=="></p>';
    const image = root.querySelector("img")!;
    Object.defineProperties(image, {
      naturalWidth: { value: 1600 },
      naturalHeight: { value: 900 }
    });

    fitDocumentImagesToPage(root, defaultExportConfig);

    expect(image.dataset.pageHeightFitted).toBeUndefined();
    expect(image.style.height).toBe("");
  });
});
