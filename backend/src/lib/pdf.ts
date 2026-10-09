import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

const BLUE = rgb(0.114, 0.306, 0.847);
const DARK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.89, 0.91, 0.94);

/** Rend un texte compatible avec l'encodage WinAnsi des polices PDF standard. */
export function pdfSafe(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u00A0\u202F\u2009]/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF’‘“”•…–—€]/g, "?");
}

export interface TableColumn {
  header: string;
  width: number;
  align?: "left" | "right";
}

/** Petit utilitaire de mise en page pour les reçus et récapitulatifs. */
export class PdfBuilder {
  private constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.page = this.addPage();
  }

  private page: PDFPage;
  private y = 0;
  private readonly margin = 48;

  static async create(title: string) {
    const doc = await PDFDocument.create();
    doc.setTitle(pdfSafe(title));
    doc.setProducer("Print & Secrétariat");
    doc.setCreator("Print & Secrétariat");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new PdfBuilder(doc, font, bold);
  }

  private addPage() {
    const page = this.doc.addPage([595.28, 841.89]);
    this.y = page.getHeight() - this.margin;
    return page;
  }

  private ensure(space: number) {
    if (this.y - space < this.margin) {
      this.page = this.addPage();
    }
  }

  get width() {
    return this.page.getWidth() - this.margin * 2;
  }

  header(title: string, subtitle: string) {
    this.page.drawRectangle({ x: this.margin, y: this.y - 34, width: 34, height: 34, color: BLUE });
    this.page.drawText("P&S", { x: this.margin + 5, y: this.y - 22, size: 10, font: this.bold, color: rgb(1, 1, 1) });
    this.page.drawText("Print & Secrétariat", { x: this.margin + 44, y: this.y - 14, size: 14, font: this.bold, color: DARK });
    this.page.drawText(pdfSafe("Vos documents, notre priorité"), { x: this.margin + 44, y: this.y - 29, size: 9, font: this.font, color: MUTED });
    this.y -= 60;
    this.text(title, { size: 18, bold: true, color: BLUE });
    this.text(subtitle, { size: 10, color: MUTED });
    this.space(8);
  }

  text(value: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const maxWidth = this.width - (opts.indent ?? 0);
    for (const line of this.wrap(pdfSafe(value), font, size, maxWidth)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: this.margin + (opts.indent ?? 0), y: this.y - size, size, font, color: opts.color ?? DARK });
      this.y -= size + 4;
    }
  }

  keyValue(label: string, value: string) {
    this.ensure(16);
    this.page.drawText(pdfSafe(label), { x: this.margin, y: this.y - 10, size: 10, font: this.font, color: MUTED });
    const v = pdfSafe(value);
    const w = this.bold.widthOfTextAtSize(v, 10);
    this.page.drawText(v, { x: this.margin + this.width - w, y: this.y - 10, size: 10, font: this.bold, color: DARK });
    this.y -= 16;
  }

  separator() {
    this.ensure(10);
    this.page.drawLine({
      start: { x: this.margin, y: this.y - 4 },
      end: { x: this.margin + this.width, y: this.y - 4 },
      thickness: 0.8,
      color: LINE,
    });
    this.y -= 12;
  }

  space(h = 10) {
    this.y -= h;
  }

  table(columns: TableColumn[], rows: string[][]) {
    const totalWidth = columns.reduce((s, c) => s + c.width, 0);
    const scale = this.width / totalWidth;
    const widths = columns.map((c) => c.width * scale);
    const drawRow = (cells: string[], bold: boolean) => {
      const font = bold ? this.bold : this.font;
      const wrapped = cells.map((c, i) => this.wrap(pdfSafe(c), font, 8.5, widths[i] - 6));
      const lines = Math.max(...wrapped.map((w) => w.length));
      const h = lines * 11 + 6;
      this.ensure(h);
      if (bold) this.page.drawRectangle({ x: this.margin, y: this.y - h, width: this.width, height: h, color: rgb(0.94, 0.96, 1) });
      let x = this.margin;
      wrapped.forEach((cellLines, i) => {
        cellLines.forEach((line, li) => {
          const w = font.widthOfTextAtSize(line, 8.5);
          const tx = columns[i].align === "right" ? x + widths[i] - 3 - w : x + 3;
          this.page.drawText(line, { x: tx, y: this.y - 12 - li * 11, size: 8.5, font, color: DARK });
        });
        x += widths[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.margin + this.width, y: this.y }, thickness: 0.5, color: LINE });
    };
    drawRow(columns.map((c) => c.header), true);
    rows.forEach((r) => drawRow(r, false));
    this.space(6);
  }

  private wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // Mot trop long : découpe forcée
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        current = rest;
      }
    }
    if (current || lines.length === 0) lines.push(current);
    return lines;
  }

  async save(): Promise<Buffer> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      p.drawText(pdfSafe(`Page ${i + 1}/${pages.length} — Print & Secrétariat — WhatsApp +237 694 600 007`), {
        x: this.margin,
        y: 24,
        size: 8,
        font: this.font,
        color: MUTED,
      });
    });
    return Buffer.from(await this.doc.save());
  }
}
