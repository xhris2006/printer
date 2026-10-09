import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env } from "../../config/env";

let converterAvailable: boolean | null = null;

/** Vérifie la présence de LibreOffice (mis en cache). */
export async function isConverterAvailable(): Promise<boolean> {
  if (converterAvailable !== null) return converterAvailable;
  converterAvailable = await new Promise<boolean>((resolve) => {
    const child = spawn(env.LIBREOFFICE_PATH, ["--version"], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 20_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
  return converterAvailable;
}

/**
 * Convertit un document Word en PDF avec LibreOffice en mode headless, dans un
 * processus séparé, avec un profil utilisateur jetable, un environnement minimal
 * et un délai maximal. Les macros ne sont jamais exécutées en mode conversion.
 */
export async function convertToPdf(inputPath: string, workDir: string): Promise<string> {
  const profileDir = await mkdtemp(path.join(tmpdir(), "lo-profile-"));
  const outDir = path.join(workDir, "out");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        env.LIBREOFFICE_PATH,
        [
          `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
          "--headless",
          "--invisible",
          "--norestore",
          "--nolockcheck",
          "--nodefault",
          "--nofirststartwizard",
          "--convert-to",
          "pdf",
          "--outdir",
          outDir,
          inputPath,
        ],
        {
          stdio: ["ignore", "ignore", "pipe"],
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: profileDir, LANG: "fr_FR.UTF-8" },
          cwd: workDir,
        },
      );
      let stderr = "";
      child.stderr?.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Délai de conversion dépassé"));
      }, env.CONVERSION_TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Conversion échouée (code ${code}) ${stderr.trim()}`.trim()));
      });
    });
    const files = (await readdir(outDir).catch(() => [])).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (files.length === 0) throw new Error("Aucun PDF produit par la conversion");
    return path.join(outDir, files[0]);
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
}
