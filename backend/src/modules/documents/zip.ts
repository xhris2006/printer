import yauzl from "yauzl";

export interface ZipInspection {
  entries: string[];
  totalUncompressed: number;
}

/** Liste le contenu d'une archive ZIP (DOCX) sans l'extraire, avec garde-fous anti « zip bomb ». */
export function inspectZip(filePath: string, limits = { maxEntries: 5000, maxUncompressed: 600 * 1024 * 1024 }): Promise<ZipInspection> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("Archive illisible"));
      const entries: string[] = [];
      let total = 0;
      zip.on("entry", (entry: yauzl.Entry) => {
        entries.push(entry.fileName);
        total += entry.uncompressedSize;
        if (entries.length > limits.maxEntries || total > limits.maxUncompressed) {
          zip.close();
          return reject(new Error("Archive anormalement volumineuse"));
        }
        zip.readEntry();
      });
      zip.on("end", () => resolve({ entries, totalUncompressed: total }));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
