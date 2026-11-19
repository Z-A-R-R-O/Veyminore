export const reportRecipient = "interfrozt.vym@gmail.com";
export function screenshotError(file: {type: string; size: number}) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Choose a PNG, JPEG or WebP screenshot.";
  if (!file.size || file.size > 5 * 1024 * 1024) return "Choose a screenshot between 1 byte and 5 MB.";
  return null;
}
function base64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
const encoded = (text: string) => base64(new TextEncoder().encode(text));
const wrap = (text: string) => text.match(/.{1,76}/g)?.join("\r\n") ?? "";
export async function emailDraft(summary: string, report: string, screenshot: File | null) {
  const boundary = `arowgo-${crypto.randomUUID()}`;
  const parts = [
    `To: ${reportRecipient}`,
    `Subject: =?UTF-8?B?${encoded("AROWGO bug: " + summary.trim().slice(0, 120))}?=`,
    "X-Unsent: 1", "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64", "", wrap(encoded(report)),
    `--${boundary}`, 'Content-Type: application/json; name="report.json"',
    'Content-Disposition: attachment; filename="report.json"',
    "Content-Transfer-Encoding: base64", "", wrap(encoded(report)),
  ];
  if (screenshot) {
    const error = screenshotError(screenshot);
    if (error) throw new Error(error);
    const ext = screenshot.type === "image/jpeg" ? "jpg" : screenshot.type.split("/")[1];
    parts.push(`--${boundary}`, `Content-Type: ${screenshot.type}`,
      `Content-Disposition: attachment; filename="screenshot.${ext}"`,
      "Content-Transfer-Encoding: base64", "", wrap(base64(new Uint8Array(await screenshot.arrayBuffer()))));
  }
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}
