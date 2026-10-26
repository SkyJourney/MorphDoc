import { z } from "zod";
import { docxStyleSlotNameSchema } from "./slots.js";

const cssValueSchema = z.string().trim().min(1).max(500);

export const docxComputedStyleSchema = z.object({
  fontFamily: cssValueSchema,
  fontSize: cssValueSchema,
  fontWeight: cssValueSchema,
  fontStyle: cssValueSchema,
  color: cssValueSchema,
  backgroundColor: cssValueSchema,
  backgroundImage: cssValueSchema.optional(),
  lineHeight: cssValueSchema,
  letterSpacing: cssValueSchema,
  textAlign: cssValueSchema,
  direction: cssValueSchema,
  textIndent: cssValueSchema,
  textDecorationLine: cssValueSchema,
  marginTop: cssValueSchema,
  marginRight: cssValueSchema,
  marginBottom: cssValueSchema,
  marginLeft: cssValueSchema,
  paddingTop: cssValueSchema,
  paddingRight: cssValueSchema,
  paddingBottom: cssValueSchema,
  paddingLeft: cssValueSchema,
  borderTop: cssValueSchema,
  borderRight: cssValueSchema,
  borderBottom: cssValueSchema,
  borderLeft: cssValueSchema,
  width: cssValueSchema,
  containingBlockWidth: cssValueSchema.optional(),
  maxWidth: cssValueSchema,
  minWidth: cssValueSchema,
  minHeight: cssValueSchema,
  height: cssValueSchema,
  breakBefore: cssValueSchema,
  breakAfter: cssValueSchema,
  breakInside: cssValueSchema,
  display: cssValueSchema,
  flexDirection: cssValueSchema,
  alignItems: cssValueSchema,
  alignSelf: cssValueSchema.optional(),
  justifyContent: cssValueSchema,
  contentPaddingLeft: cssValueSchema.optional(),
  outline: cssValueSchema,
  outlineOffset: cssValueSchema
});

export type DocxComputedStyle = z.infer<
  typeof docxComputedStyleSchema
>;

export const docxStyleSlotSnapshotSchema = z.object({
  slot: docxStyleSlotNameSchema,
  matched: z.boolean(),
  computed: docxComputedStyleSchema.optional()
});

export type DocxStyleSlotSnapshot = z.infer<
  typeof docxStyleSlotSnapshotSchema
>;

export const docxThemeStyleSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    themeId: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    themeFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    viewport: z.object({
      widthPx: z.number().int().positive().max(10000),
      heightPx: z.number().int().positive().max(10000),
      deviceScaleFactor: z.number().positive().max(10)
    }),
    rootFontSizePx: z.number().positive().max(200),
    slots: z.array(docxStyleSlotSnapshotSchema).min(1)
  })
  .superRefine((snapshot, context) => {
    const names = new Set<string>();
    for (const entry of snapshot.slots) {
      if (names.has(entry.slot)) {
        context.addIssue({
          code: "custom",
          message: `样式快照包含重复槽位：${entry.slot}`,
          path: ["slots"]
        });
      }
      names.add(entry.slot);
      if (entry.matched !== Boolean(entry.computed)) {
        context.addIssue({
          code: "custom",
          message: `槽位 ${entry.slot} 的匹配状态与计算样式不一致`,
          path: ["slots"]
        });
      }
    }
  });

export type DocxThemeStyleSnapshot = z.infer<
  typeof docxThemeStyleSnapshotSchema
>;
