import { describe, expect, it } from "vitest";
import {
  ApplicationRequestError,
  DocxExportServiceError
} from "@morphdoc/application";
import { toDesktopDocxExportFailure } from "../src/docx-contract.js";

describe("Desktop DOCX IPC 契约", () => {
  it("映射应用请求错误", () => {
    expect(
      toDesktopDocxExportFailure(
        new ApplicationRequestError(
          400,
          "INVALID_EXPORT_CONFIG",
          "导出配置无效"
        )
      )
    ).toEqual({
      ok: false,
      error: "INVALID_EXPORT_CONFIG",
      message: "导出配置无效",
      retryable: false
    });
  });

  it("保留共享服务的重试语义", () => {
    expect(
      toDesktopDocxExportFailure(
        new DocxExportServiceError(
          429,
          "DOCX_QUEUE_FULL",
          "DOCX 生成队列已满",
          true
        )
      )
    ).toEqual({
      ok: false,
      error: "DOCX_QUEUE_FULL",
      message: "DOCX 生成队列已满",
      retryable: true
    });
  });

  it("仅透传格式受控的桌面媒体超时详情", () => {
    expect(
      toDesktopDocxExportFailure(
        new DocxExportServiceError(
          500,
          "DOCX_GENERATION_FAILED",
          "DOCX 导出失败",
          false,
          { cause: new Error("桌面 DOCX 媒体布局超过 30000ms") }
        )
      )
    ).toMatchObject({
      message: "DOCX 导出失败：桌面 DOCX 媒体布局超过 30000ms"
    });
    expect(
      toDesktopDocxExportFailure(
        new DocxExportServiceError(
          500,
          "DOCX_GENERATION_FAILED",
          "DOCX 导出失败",
          false,
          {
            cause: new Error(
              "桌面 DOCX 第 2/7 个媒体（echarts）PNG 捕获超过 20000ms"
            )
          }
        )
      )
    ).toMatchObject({
      message:
        "DOCX 导出失败：桌面 DOCX 第 2/7 个媒体（echarts）PNG 捕获超过 20000ms"
    });
  });

  it("保留 Front Matter 解析错误", () => {
    expect(
      toDesktopDocxExportFailure(
        new ApplicationRequestError(
          400,
          "INVALID_FRONT_MATTER",
          "无法解析 Markdown Front Matter"
        )
      )
    ).toEqual({
      ok: false,
      error: "INVALID_FRONT_MATTER",
      message: "无法解析 Markdown Front Matter",
      retryable: false
    });
  });

  it("隐藏未知主进程错误细节", () => {
    expect(
      toDesktopDocxExportFailure(
        new Error("C:\\secret\\pandoc.exe 启动失败")
      )
    ).toEqual({
      ok: false,
      error: "DOCX_GENERATION_FAILED",
      message: "DOCX 导出失败",
      retryable: false
    });
  });
});
