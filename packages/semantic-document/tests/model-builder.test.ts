import {
  semanticDocumentModelSchema,
  type MarkdownDocumentMetadata
} from "@morphdoc/core";
import { describe, expect, it } from "vitest";
import { createSemanticDocumentModel } from "../src/index.js";

function metadata(
  input: Partial<MarkdownDocumentMetadata> = {}
): MarkdownDocumentMetadata {
  return {
    title: "",
    author: "",
    subject: "",
    keywords: [],
    language: "zh-CN",
    ...input
  };
}

describe("统一语义文档模型", () => {
  it("为普通文档记录标题去重策略但不创建结构区域", () => {
    const model = createSemanticDocumentModel({
      metadata: metadata({ title: "项目报告" }),
      firstBodyHeading: " 项目报告 "
    });
    expect(model).toEqual({
      schemaVersion: 1,
      titlePolicy: {
        metadataTitle: "suppress",
        firstBodyHeading: "keep"
      },
      regions: []
    });
  });

  it("完整表达公文版头、落款和版记的稳定顺序", () => {
    const model = createSemanticDocumentModel({
      metadata: metadata({
        title: "关于推进项目建设的通知",
        document: {
          profile: "official",
          issuer: "示例市人民政府办公室",
          number: "示例办发〔2026〕12号",
          secrecy: "内部",
          urgency: "加急",
          signatory: "张三",
          date: "2026年7月30日",
          copyTo: ["市发展改革委", "市财政局"],
          printingOffice: "示例市人民政府办公室"
        }
      })
    });
    expect(model.profile).toBe("official");
    expect(model.regions.map((item) => item.kind)).toEqual([
      "prefix",
      "suffix"
    ]);
    expect(JSON.stringify(model)).toContain("official-masthead");
    expect(JSON.stringify(model)).toContain(
      '"layout":"space-between"'
    );
    expect(JSON.stringify(model)).toContain("抄送：");
    expect(JSON.stringify(model)).toContain("2026年7月30日印发");
    expect(() => semanticDocumentModelSchema.parse(model))
      .not.toThrow();
  });

  it("表达简报前后结构并省略空字段", () => {
    const model = createSemanticDocumentModel({
      metadata: metadata({
        title: "工作简报",
        document: {
          profile: "briefing",
          masthead: "项目工作简报",
          issue: "第12期",
          contact: "联系人：张三"
        }
      })
    });
    expect(model.regions).toHaveLength(2);
    expect(JSON.stringify(model)).not.toContain(
      "briefing-signatory"
    );
    expect(JSON.stringify(model)).toContain("briefing-contact");
  });

  it.each([
    [
      "project-report",
      {
        profile: "project-report",
        projectName: "智慧园区建设项目",
        documentType: "可行性研究报告",
        owner: "示例集团"
      }
    ],
    [
      "tender",
      {
        profile: "tender",
        copyMark: "正本",
        projectName: "数据中心建设项目",
        bidder: "示例科技有限公司"
      }
    ]
  ] as const)("为 %s 创建独立封面分节意图", (_profile, document) => {
    const model = createSemanticDocumentModel({
      metadata: metadata({
        title: "项目文件",
        document
      })
    });
    expect(model.regions).toHaveLength(1);
    expect(model.regions[0]).toMatchObject({
      kind: "cover",
      section: {
        headerFooter: "none",
        pageNumber: "hidden",
        breakAfter: "next-page",
        followingPageNumberStart: 1
      }
    });
  });

  it("结构标题与首个 H1 一致时记录正文标题抑制", () => {
    const model = createSemanticDocumentModel({
      metadata: metadata({
        title: "投标文件",
        document: {
          profile: "tender",
          projectName: "示例项目"
        }
      }),
      firstBodyHeading: "投标文件"
    });
    expect(model.titlePolicy).toEqual({
      metadataTitle: "suppress",
      firstBodyHeading: "suppress"
    });
  });
});
