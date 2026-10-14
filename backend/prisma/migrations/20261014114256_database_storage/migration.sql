-- CreateTable
CREATE TABLE "StoredFile" (
    "key" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT,
    "chunkCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StoredFileChunk" (
    "fileKey" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "StoredFileChunk_pkey" PRIMARY KEY ("fileKey","index")
);

-- AddForeignKey
ALTER TABLE "StoredFileChunk" ADD CONSTRAINT "StoredFileChunk_fileKey_fkey" FOREIGN KEY ("fileKey") REFERENCES "StoredFile"("key") ON DELETE CASCADE ON UPDATE CASCADE;
