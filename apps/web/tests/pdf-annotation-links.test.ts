// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { encodeLocalDocumentLinkForPdf } from "@morphdoc/core";
import {
  createPdfAnnotationLinkService,
  resolvePdfDestinationPage,
  resolvePdfNamedActionPage
} from "../src/pdf-annotation-links";

function createDocument() {
  return {
    numPages: 5,
    getDestination: vi.fn(async (name: string) =>
      name === "chapter" ? [{ num: 7, gen: 0 }] : null
    ),
    getPageIndex: vi.fn(async () => 2)
  };
}

describe("PDF 精确预览链接服务", () => {
  it("解析命名目标、显式引用和页索引目标", async () => {
    const pdfDocument = createDocument();

    await expect(
      resolvePdfDestinationPage(pdfDocument, "chapter")
    ).resolves.toBe(3);
    await expect(
      resolvePdfDestinationPage(pdfDocument, [1, { name: "Fit" }])
    ).resolves.toBe(2);
    await expect(
      resolvePdfDestinationPage(pdfDocument, "missing")
    ).resolves.toBeUndefined();
  });

  it("将外部 URI 交给平台链接策略且阻止默认导航", () => {
    const onExternalLink = vi.fn();
    const service = createPdfAnnotationLinkService(
      createDocument(),
      2,
      {
        onExternalLink,
        onNavigateToPage: vi.fn()
      }
    );
    const link = document.createElement("a");
    service.addLinkAttributes(
      link,
      "https://example.com/document"
    );
    document.body.append(link);

    expect(link.dataset.pdfExternalHref).toBe(
      "https://example.com/document"
    );
    expect(link.rel).toBe("noopener noreferrer");
    expect(
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true
        })
      )
    ).toBe(false);
    expect(onExternalLink).toHaveBeenCalledWith(
      "https://example.com/document"
    );
  });

  it("在交给平台策略前还原 PDF 中编码的本地链接", () => {
    const onExternalLink = vi.fn();
    const service = createPdfAnnotationLinkService(
      createDocument(),
      2,
      {
        onExternalLink,
        onNavigateToPage: vi.fn()
      }
    );
    const link = document.createElement("a");
    service.addLinkAttributes(
      link,
      encodeLocalDocumentLinkForPdf("../README.md") ?? ""
    );

    expect(link.dataset.pdfExternalHref).toBe("../README.md");
    link.click();
    expect(onExternalLink).toHaveBeenCalledWith("../README.md");
  });

  it("导航到 PDF 内部目标并忽略损坏目标", async () => {
    const onNavigateToPage = vi.fn();
    const service = createPdfAnnotationLinkService(
      createDocument(),
      2,
      {
        onExternalLink: vi.fn(),
        onNavigateToPage
      }
    );

    await service.goToDestination("chapter");
    await service.goToDestination("missing");

    expect(onNavigateToPage).toHaveBeenCalledTimes(1);
    expect(onNavigateToPage).toHaveBeenCalledWith(3);
  });

  it("只处理受支持的 PDF 命名翻页动作", () => {
    expect(resolvePdfNamedActionPage("FirstPage", 3, 5)).toBe(1);
    expect(resolvePdfNamedActionPage("LastPage", 3, 5)).toBe(5);
    expect(resolvePdfNamedActionPage("NextPage", 5, 5)).toBe(5);
    expect(resolvePdfNamedActionPage("PrevPage", 1, 5)).toBe(1);
    expect(
      resolvePdfNamedActionPage("Print", 3, 5)
    ).toBeUndefined();
  });
});
