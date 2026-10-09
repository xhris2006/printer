import { createReadStream } from "node:fs";
import net from "node:net";
import { env } from "../../config/env";

export type ScanResult = { status: "clean" } | { status: "infected"; signature: string } | { status: "skipped" };

/**
 * Analyse antivirus optionnelle via clamd (protocole INSTREAM).
 * Activée uniquement si CLAMAV_HOST est défini.
 */
export function scanFile(filePath: string): Promise<ScanResult> {
  if (!env.CLAMAV_HOST) return Promise.resolve({ status: "skipped" });
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    let response = "";
    socket.setTimeout(60_000, () => {
      socket.destroy();
      reject(new Error("Délai dépassé pour l'antivirus"));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
      stream.on("data", (chunk) => {
        const buf = chunk as Buffer;
        const size = Buffer.alloc(4);
        size.writeUInt32BE(buf.length, 0);
        socket.write(size);
        socket.write(buf);
      });
      stream.on("end", () => socket.write(Buffer.alloc(4)));
      stream.on("error", (e) => {
        socket.destroy();
        reject(e);
      });
    });
    socket.on("data", (d) => {
      response += d.toString();
    });
    socket.on("end", () => {
      const text = response.replace(/\0/g, "").trim();
      if (text.endsWith("OK")) resolve({ status: "clean" });
      else if (text.includes("FOUND")) resolve({ status: "infected", signature: text.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "") });
      else reject(new Error(`Réponse antivirus inattendue : ${text}`));
    });
    socket.on("error", reject);
  });
}
