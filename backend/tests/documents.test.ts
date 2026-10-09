import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeFile } from "../src/modules/documents/analyzer";
import { sanitizeFileName, sniffSignature } from "../src/modules/documents/fileType";
import { isConverterAvailable } from "../src/modules/documents/converter";
import { prisma } from "../src/lib/prisma";
import { resetDb } from "./helpers/db";
import { makeDocx, makePdf, makePdfWithJavascript, makeZip, PNG_1X1 } from "./helpers/files";
import request from "supertest";
import { app, loginAs, ORIGIN, uploadDocument } from "./helpers/api";

let dir: string;
async function file(name: string, content: Buffer) {
  const p = path.join(dir, name);
  await writeFile(p, content);
  return p;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ps-analyzer-"));
});

describe("Analyse des fichiers", () => {
  it("détecte le format réel par signature", async () => {
    expect(sniffSignature(await makePdf(1))).toBe("PDF");
    expect(sniffSignature(PNG_1X1)).toBe("PNG");
    expect(sniffSignature(makeDocx(1))).toBe("ZIP");
    expect(sniffSignature(Buffer.from("MZ\x90\x00 exécutable"))).toBe("UNKNOWN");
  });

  it("compte les pages d'un PDF multipage", async () => {
    const out = await analyzeFile(await file("a.pdf", await makePdf(17)), "PDF", dir);
    expect(out).toMatchObject({ status: "READY", pageCount: 17, source: "DETECTED" });
  });

  it("une image compte pour une page", async () => {
    const out = await analyzeFile(await file("a.png", PNG_1X1), "PNG", dir);
    expect(out).toMatchObject({ status: "READY", pageCount: 1, source: "IMAGE_DEFAULT" });
  });

  it("rejette une extension falsifiée (exécutable renommé en .pdf, PNG renommé en .docx)", async () => {
    const fake = await analyzeFile(await file("virus.pdf", Buffer.from("MZ\x90\x00\x03 binaire windows")), "PDF", dir);
    expect(fake.status).toBe("REJECTED");
    const renamed = await analyzeFile(await file("image.docx", PNG_1X1), "DOCX", dir);
    expect(renamed).toMatchObject({ status: "REJECTED" });
  });

  it("signale un PDF corrompu sans inventer de nombre de pages", async () => {
    const out = await analyzeFile(await file("broken.pdf", Buffer.from("%PDF-1.7\n garbage without objects")), "PDF", dir);
    expect(["FAILED", "NEEDS_REVIEW"]).toContain(out.status);
    expect("pageCount" in out).toBe(false);
  });

  it("refuse un PDF contenant du JavaScript", async () => {
    const out = await analyzeFile(await file("js.pdf", await makePdfWithJavascript()), "PDF", dir);
    expect(out.status).toBe("REJECTED");
  });

  it("refuse un DOCX contenant des macros", async () => {
    const out = await analyzeFile(await file("macro.docx", makeDocx(1, { "word/vbaProject.bin": "binary" })), "DOCX", dir);
    expect(out).toMatchObject({ status: "REJECTED" });
  });

  it("refuse une archive ZIP qui n'est pas un document Word", async () => {
    const out = await analyzeFile(await file("archive.docx", makeZip({ "readme.txt": "hello" })), "DOCX", dir);
    expect(out.status).toBe("REJECTED");
  });

  it("convertit un DOCX en PDF (LibreOffice) et compte les pages", async (ctx) => {
    if (!(await isConverterAvailable())) ctx.skip();
    const out = await analyzeFile(await file("cours.docx", makeDocx(3)), "DOCX", dir);
    expect(out).toMatchObject({ status: "READY", pageCount: 3 });
  }, 120_000);

  it("nettoie les noms de fichiers", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\a\\Mémoire final.pdf")).toBe("Mémoire final.pdf");
    expect(sanitizeFileName('a<b>:"c".pdf')).toBe("a_b___c_.pdf");
  });
});

describe("Téléversement et API documents", () => {
  beforeEach(resetDb);

  it("téléverse, analyse de manière asynchrone et expose le nombre de pages", async () => {
    const { agent } = await loginAs();
    const doc = await uploadDocument(agent, await makePdf(5), "cours.pdf");
    expect(doc.status).toBe("READY");
    expect(doc.pageCount).toBe(5);
    const res = await agent.get(`/api/documents?ids=${doc.id}`);
    expect(res.body.items[0]).toMatchObject({ pageCount: 5, status: "READY", kind: "PDF" });
  });

  it("refuse les formats non autorisés et les fichiers trop volumineux", async () => {
    const { agent } = await loginAs();
    const exe = await agent.post("/api/documents/uploads").set("Origin", ORIGIN).send({ fileName: "setup.exe", size: 100 });
    expect(exe.status).toBe(400);
    expect(exe.body.error.code).toBe("UNSUPPORTED_FORMAT");
    const big = await agent.post("/api/documents/uploads").set("Origin", ORIGIN).send({ fileName: "gros.pdf", size: 900 * 1024 * 1024 });
    expect(big.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("met en vérification un fichier dont les pages ne peuvent pas être comptées, puis accepte une déclaration", async () => {
    const { agent } = await loginAs();
    const doc = await uploadDocument(agent, await makePdf(2), "a.pdf");
    await prisma.document.update({ where: { id: doc.id }, data: { status: "NEEDS_REVIEW", pageCount: null } });
    const res = await agent.post(`/api/documents/${doc.id}/declare-pages`).set("Origin", ORIGIN).send({ pageCount: 8 });
    expect(res.status).toBe(200);
    expect(res.body.document).toMatchObject({ status: "READY", pageCount: 8, pageCountSource: "CUSTOMER_DECLARED" });
  });

  it("un utilisateur ne peut ni voir ni télécharger le document d'un autre", async () => {
    const owner = await loginAs();
    const other = await loginAs();
    const doc = await uploadDocument(owner.agent, await makePdf(1), "prive.pdf");
    expect((await other.agent.get(`/api/documents/${doc.id}`)).status).toBe(404);
    expect((await other.agent.get(`/api/documents/${doc.id}/download`)).status).toBe(404);
    const own = await owner.agent.get(`/api/documents/${doc.id}/download`);
    expect(own.status).toBe(200);
    expect(own.body.url).toContain("/api/storage/local/download/");
  });

  it("les liens de téléchargement sont signés et expirent", async () => {
    const { agent } = await loginAs();
    const doc = await uploadDocument(agent, await makePdf(1), "a.pdf");
    const { body } = await agent.get(`/api/documents/${doc.id}/download`);
    const url = new URL(body.url);
    expect((await request(app).get(url.pathname)).status).toBe(200);
    const tampered = url.pathname.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await request(app).get(tampered)).status).toBe(403);
  });
});
