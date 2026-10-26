export async function createDocxThemeStyleFingerprint(
  themeId: string,
  themeCss: string
): Promise<string> {
  const content = new TextEncoder().encode(
    `docx-theme-style-v1\0${themeId}\0${themeCss}`
  );
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    content
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
