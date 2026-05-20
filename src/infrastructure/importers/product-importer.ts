import admin from "firebase-admin";
import { JWT } from "google-auth-library";
import { google } from "googleapis";
import path from "path";
import fs from "fs";
import os from "os";
import ExcelJS from "exceljs";

// -------------------------
// CONFIGURATION
// -------------------------
const FIREBASE_SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service.json";
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const GOOGLE_SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH || "./google-service.json";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || "ivory-rose.firebasestorage.app";
const PRODUCT_IMPORT_CONCURRENCY = parseBoundedInteger(
  process.env.PRODUCT_IMPORT_CONCURRENCY,
  4,
  1,
  12
);
const PRODUCT_IMPORT_IMAGE_CONCURRENCY = parseBoundedInteger(
  process.env.PRODUCT_IMPORT_IMAGE_CONCURRENCY,
  6,
  1,
  16
);

/**
 * Optional: Workspace user email for domain-wide delegation. Lets Drive create/update files in My Drive
 * shared folders (service accounts have no personal storage quota).
 * Set in Admin Console: Security > API controls > Domain-wide delegation for this SA client id, scope https://www.googleapis.com/auth/drive
 */
const GOOGLE_DRIVE_IMPERSONATE_USER = process.env.GOOGLE_DRIVE_IMPERSONATE_USER?.trim() || "";

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex++;
        results[index] = await worker(items[index], index);
      }
    })
  );

  return results;
}

function getFirebaseCredential(): admin.ServiceAccount {
  if (FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON) as admin.ServiceAccount;
  }
  const resolved = path.resolve(process.cwd(), FIREBASE_SERVICE_ACCOUNT_PATH);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Firebase service account file not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf-8")) as admin.ServiceAccount;
}

type ImportDriveAuth = InstanceType<typeof google.auth.GoogleAuth> | JWT;

function jwtFromServiceAccount(
  clientEmail: string,
  privateKey: string,
  scopes: string[]
): JWT {
  return new JWT({
    email: clientEmail,
    key: privateKey,
    scopes,
    subject: GOOGLE_DRIVE_IMPERSONATE_USER || undefined,
  });
}

/** Full Drive scope so the service account can update/create files in folders shared with it (import write-back). */
function getGoogleAuth(): ImportDriveAuth {
  const scopes = ["https://www.googleapis.com/auth/drive"];
  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON) as {
      client_email?: string;
      private_key?: string;
    };
    if (GOOGLE_DRIVE_IMPERSONATE_USER && credentials.client_email && credentials.private_key) {
      return jwtFromServiceAccount(credentials.client_email, credentials.private_key, scopes);
    }
    return new google.auth.GoogleAuth({ credentials: JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON), scopes });
  }
  const resolved = path.resolve(process.cwd(), GOOGLE_SERVICE_ACCOUNT_PATH);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Google service account file not found: ${resolved}`);
  }
  if (GOOGLE_DRIVE_IMPERSONATE_USER) {
    const raw = JSON.parse(fs.readFileSync(resolved, "utf-8")) as {
      client_email?: string;
      private_key?: string;
    };
    if (!raw.client_email || !raw.private_key) {
      throw new Error("Service account JSON must include client_email and private_key for Drive impersonation");
    }
    return jwtFromServiceAccount(raw.client_email, raw.private_key, scopes);
  }
  return new google.auth.GoogleAuth({ keyFile: resolved, scopes });
}

function getFirebaseAdmin() {
  if (admin.apps.length === 0) {
    const credential = getFirebaseCredential();
    admin.initializeApp({
      credential: admin.credential.cert(credential),
      storageBucket: FIREBASE_STORAGE_BUCKET,
    });
  }
  return admin;
}

// -------------------------
// HELPERS - Path & filename
// -------------------------
function sanitizeFileName(fileName: string): string {
  if (!fileName || typeof fileName !== "string") return "unnamed";
  return fileName.replace(/[<>:"|?*\x00-\x1f/\\]/g, "").trim() || "unnamed";
}

function validateAndSanitizePath(filePath: string, baseDir: string): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid file path: path must be a non-empty string");
  }
  const resolvedPath = path.resolve(baseDir, filePath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  const sanitized = path.basename(filePath).replace(/[<>:"|?*\x00-\x1f]/g, "");
  if (!sanitized || sanitized !== path.basename(filePath)) {
    throw new Error(`Invalid filename: ${filePath} contains dangerous characters`);
  }
  return resolvedPath;
}

// -------------------------
// HELPERS - Product ID & style
// -------------------------
function extractProductId(fileName: string): string {
  if (!fileName || typeof fileName !== "string") return "";
  try {
    let cleaned = path.basename(fileName);
    cleaned = cleaned.replace(/\.(xlsx|xls|png|jpg|jpeg|pdf)$/i, "");
    cleaned = cleaned.replace(/\s*\(\d+\)\s*$/g, "");
    const lowerCleaned = cleaned.toLowerCase();
    if (lowerCleaned.includes("copy of") || lowerCleaned.startsWith("copyof")) {
      cleaned = cleaned.replace(/\bcopy\s+of\b/gi, "").replace(/\bcopyof\b/gi, "");
    }
    cleaned = cleaned.replace(/\s*-\s*cad\b/gi, "").replace(/\bcad\b/gi, "");
    cleaned = cleaned.replace(/\s*-\s*details\b/gi, "").replace(/\bdetails\b/gi, "");
    cleaned = cleaned.replace(/\s*-\s*names\b/gi, "").replace(/\bnames\b/gi, "");
    cleaned = cleaned.replace(/\s+/g, " ").trim().replace(/^[\s-]+|[\s-]+$/g, "");
    const stylePattern = /([A-Z]{2})\d{4}([a-zA-Z])?(-([A-Z]+)([a-zA-Z])?)?/i;
    const match = cleaned.match(stylePattern);
    if (match) {
      const prefix = match[1].toUpperCase();
      const digitsMatch = match[0].match(/\d{4}/);
      const digits = digitsMatch ? digitsMatch[0] : "";
      const baseVariant = match[2] || "";
      const suffixCode = match[4] ? match[4].toUpperCase() : "";
      const suffixVariant = match[5] || "";
      let productId = prefix + digits + baseVariant;
      if (suffixCode) productId += "-" + suffixCode + suffixVariant;
      return productId;
    }
    if (!cleaned) return path.parse(fileName).name || fileName;
    return cleaned;
  } catch {
    return path.parse(fileName).name || fileName;
  }
}

const CATEGORY_SUFFIX: Record<string, string> = {
  TI: "Tikka", E: "Earrings", R: "Rings", BR: "Bracelet", PP: "Pendant", PS: "Pendant",
  XC: "Bangles", XK: "Bangles", XR: "Bangles", XV: "Bangles", RB: "Rings", RG: "Rings",
  RR: "Rings", RS: "Rings", BT: "Buttons", CU: "Cufflinks", ND: "Necklaces", NN: "Necklaces",
  NS: "Necklaces", EB: "Earrings", ED: "Earrings", ES: "Earrings", ET: "Earrings",
  EJ: "Earrings", NC: "Chokers", BY: "Brooch", BA: "Bajuband",
};

const CATEGORY_PREFIX: Record<string, string[]> = {
  Bracelet: ["BD", "BR", "BS"], Pendant: ["PP", "PS"], Bangles: ["XC", "XK", "XR", "XV"],
  Rings: ["RB", "RG", "RR", "RS"], Buttons: ["BT"], Cufflinks: ["CU"],
  Necklaces: ["ND", "NN", "NS"], Earrings: ["E", "EB", "ED", "ES", "ET", "EJ"],
  Chokers: ["NC"], Tikka: ["TI"], Brooch: ["BY"], Bajuband: ["BA"],
};

interface ParsedStyle {
  prefix: string | null;
  baseVariant: string | null;
  suffixCode: string | null;
  suffixVariant: string | null;
}

function parseStyleNumber(styleNumber: string): ParsedStyle {
  if (!styleNumber || typeof styleNumber !== "string") {
    return { prefix: null, baseVariant: null, suffixCode: null, suffixVariant: null };
  }
  const KNOWN_SUFFIX_CODES = new Set([
    "E", "R", "TI", "BR", "PP", "PS", "XC", "XK", "XR", "XV", "RB", "RG", "RR", "RS",
    "BT", "CU", "ND", "NN", "NS", "EB", "ED", "ES", "ET", "EJ", "NC", "BY", "BA",
  ]);
  const pattern = /^([A-Z]{2})\d{4}([a-zA-Z])?(-([A-Z]+)([a-zA-Z])?)?$/i;
  const match = styleNumber.match(pattern);
  if (!match) {
    const prefix = styleNumber.substring(0, 2).toUpperCase();
    return {
      prefix: prefix.length === 2 ? prefix : null,
      baseVariant: null,
      suffixCode: null,
      suffixVariant: null,
    };
  }
  let suffixCode = match[4] ? match[4].toUpperCase() : null;
  let suffixVariant = match[5] || null;
  if (suffixCode && !suffixVariant && suffixCode.length > 1 && !KNOWN_SUFFIX_CODES.has(suffixCode)) {
    const potentialCode = suffixCode.slice(0, -1);
    const potentialVariant = suffixCode.slice(-1);
    if (KNOWN_SUFFIX_CODES.has(potentialCode)) {
      suffixCode = potentialCode;
      suffixVariant = potentialVariant.toLowerCase();
    }
  }
  if (suffixVariant) suffixVariant = suffixVariant.toLowerCase();
  return {
    prefix: match[1].toUpperCase(),
    baseVariant: match[2] || null,
    suffixCode,
    suffixVariant,
  };
}

function detectCategory(productId: string, parsedStyle: ParsedStyle | null): string {
  if (parsedStyle?.suffixCode && CATEGORY_SUFFIX[parsedStyle.suffixCode]) {
    return CATEGORY_SUFFIX[parsedStyle.suffixCode];
  }
  const prefix = (parsedStyle?.prefix ?? productId.substring(0, 2)).toUpperCase();
  for (const [category, prefixes] of Object.entries(CATEGORY_PREFIX)) {
    if (prefixes.includes(prefix)) return category;
  }
  return "Others";
}

// -------------------------
// HELPERS - Stone summary & materials
// -------------------------
const STONE_TYPE_MAP: Record<string, string> = {
  RUB: "Ruby", DIA: "Diamond", EME: "Emerald", SAP: "Sapphire", PRL: "Pearl", COR: "Coral",
  AM: "Amethyst", CT: "Citrine", TO: "Topaz", PE: "Peridot", GA: "Garnet", AQ: "Aquamarine",
  TAN: "Tanzanite", OP: "Opal", TOU: "Tourmaline", ZO: "Zircon", SP: "Spinel", MO: "Morganite",
  KU: "Kunzite", TS: "Tsavorite", AME: "Amethyst", CIT: "Citrine", CORAL: "Coral", CUZ: "Cubic Zirconia",
  DYEL: "Yellow Diamond", ENM: "Enamel", GTO: "Golden Topaz", GAR: "Garnet", LYEL: "Yellow Sapphire",
  MOP: "Mother of Pearl", OLD: "Old Mine Diamond", ONY: "Onyx", PER: "Peridot", PINK: "Pink Sapphire",
  PREC: "Precious Stone", PTO: "Pink Topaz", ROS: "Rose Quartz", RUE: "Ruby", SBT: "Sapphire",
  SEMI: "Semi-precious Stone", TUR: "Turquoise", WSA: "White Sapphire", WTO: "White Topaz",
  YSA: "Yellow Sapphire", YELL: "Yellow Sapphire",
};

interface StoneRow {
  typ: string;
  shp: string;
  qly: string;
  lot: string;
  band: string;
  mmSize: string;
  avWt: number;
  qty: number;
  twt: number;
  location: string;
  remarks: string;
}

function extractMaterials(stoneSummary: StoneRow[]): string[] {
  const materialsSet = new Set<string>();
  for (const stone of stoneSummary) {
    if (stone.typ) {
      const typUpper = String(stone.typ).trim().toUpperCase();
      if (STONE_TYPE_MAP[typUpper]) materialsSet.add(STONE_TYPE_MAP[typUpper]);
    }
  }
  return Array.from(materialsSet).sort();
}

function generateTags(category: string, materials: string[], relationType: string): string[] {
  const tags = new Set<string>();
  if (category) tags.add(category.toLowerCase());
  if (materials?.length) {
    materials.forEach((m) => m && tags.add(m.toLowerCase()));
  }
  if (relationType === "MATCHING") tags.add("matching");
  return Array.from(tags).sort();
}

function calculateStoneSummary(rows: StoneRow[]): { typ: string; qty: number; twt: number }[] {
  const summaryMap = new Map<string, { typ: string; qty: number; twt: number }>();
  for (const row of rows) {
    const typ = String(row.typ || "").trim();
    if (!typ) continue;
    const qty = Number(row.qty) || 0;
    const twt = Number(row.twt) || 0;
    if (summaryMap.has(typ)) {
      const existing = summaryMap.get(typ)!;
      existing.qty += qty;
      existing.twt += twt;
    } else {
      summaryMap.set(typ, { typ, qty, twt });
    }
  }
  return Array.from(summaryMap.values());
}

// -------------------------
// Excel - blank row & read
// -------------------------
function isBlankRow(row: (string | number)[]): boolean {
  if (!row || row.length < 11) return true;
  const [typ, shp, , , , , , qty, twt] = row;
  const typStr = String(typ ?? "").trim();
  const shpStr = String(shp ?? "").trim();
  const qtyNum = Number(qty) || 0;
  const twtNum = Number(twt) || 0;
  const hasTypOrShp = typStr !== "" || shpStr !== "";
  const hasQuantity = qtyNum > 0 || twtNum > 0;
  return !(hasTypOrShp && hasQuantity);
}

function pickDetailWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
  const targetNames = ["detail", "details"];
  for (const name of targetNames) {
    const ws = workbook.getWorksheet(name);
    if (ws) return ws;
  }
  const found = workbook.worksheets.find((ws) =>
    targetNames.includes((ws.name || "").trim().toLowerCase())
  );
  if (found) return found;
  return workbook.worksheets[0];
}

async function readExcelFile(filePath: string): Promise<{ rows: StoneRow[]; assumingNetWt: number | string | null }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = pickDetailWorksheet(workbook);
  if (!worksheet) throw new Error("No worksheet found in Excel file");

  let assumingNetWt: number | string | null = null;
  try {
    const firstDataRow = worksheet.getRow(2);
    if (firstDataRow) {
      const cell = firstDataRow.getCell(1);
      let cellValue = cell.value;
      if (cellValue != null && typeof cellValue === "object" && "result" in cellValue) {
        cellValue = (cellValue as { result?: number }).result;
      }
      if (typeof cellValue === "number") assumingNetWt = cellValue;
      else if (cellValue != null && String(cellValue).trim() !== "") {
        const n = Number(cellValue);
        assumingNetWt = !Number.isNaN(n) ? n : String(cellValue).trim();
      }
    }
  } catch {
    // ignore
  }

  const rows: StoneRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < 2) return;
    const rowData: (string | number)[] = [];
    for (let colNum = 2; colNum <= 12; colNum++) {
      const cell = row.getCell(colNum);
      const cellValue = cell.value;
      const resolved: string | number =
        cellValue == null
          ? ""
          : typeof cellValue === "object" && "result" in cellValue
            ? String((cellValue as { result?: unknown }).result ?? "")
            : (cellValue as string | number);
      if (typeof resolved === "number") rowData.push(resolved);
      else if (resolved === "" || resolved == null) rowData.push("");
      else {
        const n = Number(resolved);
        rowData.push(!Number.isNaN(n) && String(resolved).trim() !== "" ? n : String(resolved).trim());
      }
    }
    if (!isBlankRow(rowData)) {
      const [typ, shp, qly, lot, band, mmSize, avWt, qty, twt, location, remarks] = rowData;
      const avWtNum = typeof avWt === "number" ? avWt : (avWt ? parseFloat(String(avWt).replace(/,/g, "")) : 0) || 0;
      const qtyNum = typeof qty === "number" ? qty : (qty ? parseFloat(String(qty).replace(/,/g, "")) : 0) || 0;
      const twtNum = typeof twt === "number" ? twt : (twt ? parseFloat(String(twt).replace(/,/g, "")) : 0) || 0;
      rows.push({
        typ: String(typ ?? "").trim(),
        shp: String(shp ?? "").trim(),
        qly: String(qly ?? "").trim(),
        lot: String(lot ?? "").trim(),
        band: String(band ?? "").trim(),
        mmSize: String(mmSize ?? "").trim(),
        avWt: Number.isNaN(avWtNum) ? 0 : avWtNum,
        qty: Number.isNaN(qtyNum) ? 0 : qtyNum,
        twt: Number.isNaN(twtNum) ? 0 : twtNum,
        location: String(location ?? "").trim(),
        remarks: String(remarks ?? "").trim(),
      });
    }
  });
  return { rows, assumingNetWt };
}

// -------------------------
// Compare & save
// -------------------------
/** Deep-normalize values so Firestore reads compare reliably to freshly built import payloads. */
function toComparableValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof admin.firestore.Timestamp) {
    return value.toMillis();
  }
  if (typeof value === "object") {
    const maybeTs = value as { seconds?: number; nanoseconds?: number; toDate?: () => Date };
    if (typeof maybeTs.toDate === "function") {
      return maybeTs.toDate().getTime();
    }
    if (typeof maybeTs.seconds === "number") {
      const ns = typeof maybeTs.nanoseconds === "number" ? maybeTs.nanoseconds : 0;
      return maybeTs.seconds * 1000 + Math.floor(ns / 1e6);
    }
    if (Array.isArray(value)) {
      return value.map(toComparableValue);
    }
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = toComparableValue(obj[k]);
    }
    return out;
  }
  return value;
}

function compareProductData(
  newData: Record<string, unknown>,
  existingData: Record<string, unknown>
): boolean {
  const ignoreFields = ["createdAt", "updatedAt"];
  const newClean = { ...newData };
  const existingClean = { ...existingData };
  ignoreFields.forEach((f) => {
    delete (newClean as Record<string, unknown>)[f];
    delete (existingClean as Record<string, unknown>)[f];
  });
  const normalize = (obj: unknown): string => JSON.stringify(toComparableValue(obj));
  return normalize(newClean) === normalize(existingClean);
}

// -------------------------
// Drive list & download
// -------------------------
type DriveFile = { id: string; name: string; mimeType?: string };

async function listDriveFiles(
  drive: ReturnType<typeof google.drive>,
  folderId: string
): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [];
  let pageToken: string | null = null;
  do {
    const params: { q: string; fields: string; orderBy: string; pageSize: number; pageToken?: string } = {
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      orderBy: "name",
      pageSize: 1000,
    };
    if (pageToken) params.pageToken = pageToken;
    const response = await drive.files.list({
      ...params,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (response.data.files?.length) {
      allFiles.push(...(response.data.files as DriveFile[]));
    }
    pageToken = response.data.nextPageToken ?? null;
  } while (pageToken);
  return allFiles;
}

async function downloadFileToPath(
  drive: ReturnType<typeof google.drive>,
  fileId: string,
  destPath: string,
  mimeType: string | undefined
): Promise<void> {
  let response: { data: unknown };
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    response = (await drive.files.export(
      {
        fileId,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      { responseType: "arraybuffer" }
    )) as { data: unknown };
  } else {
    response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
  }
  const buffer = Buffer.from(response.data as ArrayBuffer);
  fs.writeFileSync(destPath, buffer);
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function exportedSpreadsheetXlsxName(sourceName: string): string {
  const base = path.basename(sourceName);
  const stem = path.parse(base).name;
  const safe = sanitizeFileName(stem) || "export";
  return `${safe}.xlsx`;
}

function imageMimeFromName(fileName: string, fallback?: string): string {
  if (fallback && fallback.startsWith("image/")) return fallback;
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

async function findXlsxByNameInFolder(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  fileName: string
): Promise<string | null> {
  const q = `'${escapeDriveQueryLiteral(folderId)}' in parents and name = '${escapeDriveQueryLiteral(fileName)}' and mimeType = '${escapeDriveQueryLiteral(XLSX_MIME)}' and trashed=false`;
  const res = await drive.files.list({
    q,
    fields: "files(id)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const id = res.data.files?.[0]?.id;
  return id ?? null;
}

type DownloadedAssetImage = {
  path: string;
  name: string;
  driveFileId: string;
  mimeType?: string;
};

type UploadedImageResult =
  | { url: string; error?: never }
  | { error: string; url?: never };

function shouldSuppressDriveSyncWarning(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("insufficient permissions for the specified parent") ||
    normalized.includes("user does not have sufficient permissions for this file")
  );
}

async function syncProductAssetsToDrive(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  productId: string,
  excelPath: string | null,
  excelFile: DriveFile | null,
  images: DownloadedAssetImage[],
  driveSyncErrors: { productId: string; error: string }[]
): Promise<void> {
  const errs: string[] = [];

  if (excelPath && fs.existsSync(excelPath) && excelFile) {
    const mime = excelFile.mimeType || "";
    try {
      if (mime === "application/vnd.google-apps.spreadsheet") {
        const exportName = exportedSpreadsheetXlsxName(excelFile.name);
        const existingId = await findXlsxByNameInFolder(drive, folderId, exportName);
        const media = { mimeType: XLSX_MIME, body: fs.createReadStream(excelPath) };
        if (existingId) {
          await drive.files.update({
            fileId: existingId,
            media,
            supportsAllDrives: true,
          });
        } else {
          await drive.files.create({
            requestBody: {
              name: exportName,
              parents: [folderId],
              mimeType: XLSX_MIME,
            },
            media,
            supportsAllDrives: true,
            fields: "id",
          });
        }
      } else if (
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mime === "application/vnd.ms-excel"
      ) {
        await drive.files.update({
          fileId: excelFile.id,
          media: {
            mimeType: mime === "application/vnd.ms-excel" ? "application/vnd.ms-excel" : XLSX_MIME,
            body: fs.createReadStream(excelPath),
          },
          supportsAllDrives: true,
        });
      }
    } catch (err) {
      errs.push(`Excel Drive sync: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const imageSyncErrors = await mapConcurrent(
    images,
    PRODUCT_IMPORT_IMAGE_CONCURRENCY,
    async (img) => {
      if (!fs.existsSync(img.path)) return null;
      try {
        const mime = imageMimeFromName(img.name, img.mimeType);
        await drive.files.update({
          fileId: img.driveFileId,
          media: { mimeType: mime, body: fs.createReadStream(img.path) },
          supportsAllDrives: true,
        });
        return null;
      } catch (err) {
        return `Image ${img.name}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  );
  errs.push(...imageSyncErrors.filter((err): err is string => Boolean(err)));

  if (errs.length > 0) {
    const visibleErrors = errs.filter((err) => !shouldSuppressDriveSyncWarning(err));
    if (visibleErrors.length > 0) {
      driveSyncErrors.push({ productId, error: visibleErrors.join("; ") });
    }
  }
}

// -------------------------
// Firebase Storage upload
// -------------------------
/** Type for Storage bucket used by uploadImage (avoids firebase-admin storage.Bucket type export). */
type StorageBucketLike = {
  upload(path: string, opts: { destination: string; metadata: { contentType: string } }): Promise<unknown>;
  file(path: string): { makePublic(): Promise<unknown> };
  name: string;
};

async function uploadImage(
  bucket: StorageBucketLike,
  category: string,
  fullStyleNo: string,
  filePath: string,
  originalFileName: string
): Promise<{ url: string; storagePath: string }> {
  const sanitizedCategory = sanitizeFileName(category);
  const sanitizedStyleNo = sanitizeFileName(fullStyleNo);
  const sanitizedFileName = sanitizeFileName(originalFileName);
  const storagePath = `Products/${sanitizedCategory}/${sanitizedStyleNo}/${sanitizedFileName}`;
  const ext = path.extname(originalFileName).toLowerCase();
  const contentTypeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const contentType = contentTypeMap[ext] || "image/png";

  await bucket.upload(filePath, {
    destination: storagePath,
    metadata: { contentType },
  });
  const file = bucket.file(storagePath);
  await file.makePublic();
  const encodedPath = encodeURIComponent(storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
  return { url, storagePath };
}

// -------------------------
// Process single product
// -------------------------
export type ImportProductResult = "CREATE" | "UPDATE" | "SKIP" | "ERRORED";

async function processProduct(
  db: admin.firestore.Firestore,
  bucket: StorageBucketLike,
  excelPath: string | null,
  productId: string,
  imagePaths: { path: string; name: string }[]
): Promise<{ status: ImportProductResult; productId: string; error?: string }> {
  const processingErrors: string[] = [];
  let rows: StoneRow[] = [];
  let assumingNetWt: number | string | null = null;
  let parsedStyle: ParsedStyle | null = null;
  let category = "Others";
  const imageUrls: string[] = [];
  let thumbnailUrl = "";
  let materials: string[] = [];
  let tags: string[] = [];

  if (excelPath && fs.existsSync(excelPath)) {
    try {
      const excelData = await readExcelFile(excelPath);
      rows = excelData.rows || [];
      assumingNetWt = excelData.assumingNetWt ?? null;
    } catch (err) {
      processingErrors.push(`Excel read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    parsedStyle = parseStyleNumber(productId);
    if (!parsedStyle?.prefix) {
      const prefix = productId.substring(0, 2).toUpperCase();
      parsedStyle = {
        prefix: prefix.length === 2 ? prefix : null,
        baseVariant: null,
        suffixCode: null,
        suffixVariant: null,
      };
    }
  } catch {
    parsedStyle = {
      prefix: productId.substring(0, 2).toUpperCase() || null,
      baseVariant: null,
      suffixCode: null,
      suffixVariant: null,
    };
  }

  category = detectCategory(productId, parsedStyle) || "Others";

  const stoneSummary: StoneRow[] = [];
  for (const r of rows) {
    if (isBlankRow([r.typ, r.shp, "", "", "", "", "", r.qty, r.twt, "", ""])) continue;
    stoneSummary.push(r);
  }
  const aggregatedSummary = calculateStoneSummary(stoneSummary);
  materials = extractMaterials(stoneSummary);
  const isMatching = parsedStyle?.suffixCode ? "MATCHING" : "BASE";
  tags = generateTags(category, materials, isMatching);

  const productRef = db.collection("products").doc(productId);
  let existingDoc: admin.firestore.DocumentSnapshot | null = null;
  let existingData: Record<string, unknown> | null = null;
  try {
    existingDoc = await productRef.get();
    if (existingDoc.exists) existingData = existingDoc.data() as Record<string, unknown>;
  } catch (err) {
    processingErrors.push(`Read existing: ${err instanceof Error ? err.message : String(err)}`);
  }

  const matchingImages = imagePaths.filter((img) => {
    const extracted = extractProductId(img.name);
    return extracted.toUpperCase() === productId.toUpperCase();
  });
  matchingImages.sort((a, b) => a.name.localeCompare(b.name));

  const uploadedImages = await mapConcurrent<typeof matchingImages[number], UploadedImageResult>(
    matchingImages,
    PRODUCT_IMPORT_IMAGE_CONCURRENCY,
    async (img) => {
      try {
        const { url } = await uploadImage(bucket, category, productId, img.path, img.name);
        return { url };
      } catch (err) {
        return {
          error: `Upload ${img.name}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  );
  for (const uploaded of uploadedImages) {
    if (typeof uploaded.error === "string") {
      processingErrors.push(uploaded.error);
    } else {
      imageUrls.push(uploaded.url);
      if (!thumbnailUrl) thumbnailUrl = uploaded.url;
    }
  }

  if (stoneSummary.length > 0) {
    try {
      const rowsRef = db.collection("products").doc(productId).collection("rows").doc(productId);
      await rowsRef.set({
        rows: stoneSummary,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      processingErrors.push(`Save rows: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const productData: Record<string, unknown> = {
    productId,
    category,
    productType: category,
    isActive: true,
    prefix: parsedStyle?.prefix ?? productId.substring(0, 2).toUpperCase(),
    baseVariant: parsedStyle?.baseVariant ?? null,
    suffixCode: parsedStyle?.suffixCode ?? null,
    suffixVariant: parsedStyle?.suffixVariant ?? null,
    tags: tags || [],
    materials: materials || [],
    imageUrls: imageUrls || [],
    thumbnailUrl: thumbnailUrl || "",
    stoneSummary: aggregatedSummary || [],
    assumingNetWt: assumingNetWt ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (processingErrors.length > 0) {
    productData.processingErrors = processingErrors;
  }

  let status: ImportProductResult;
  if (!existingDoc?.exists) {
    status = "CREATE";
    productData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    await productRef.set(productData, { merge: true });
    return { status, productId };
  }

  const payloadUnchanged = compareProductData(productData, existingData ?? {});
  if (payloadUnchanged) {
    console.log("[import-products] product unchanged; skipped Firestore product write", {
      productId,
    });
    return { status: "SKIP", productId };
  }
  await productRef.set(productData, { merge: true });
  status = "UPDATE";
  return { status, productId };
}

// -------------------------
// Main export
// -------------------------
export type RunProductImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  total: number;
  errors: { productId: string; error: string }[];
  /** Non-fatal failures writing Excel/images back to Drive after a successful Firestore import. */
  driveSyncErrors: { productId: string; error: string }[];
};

type ProductImportGroup = {
  productId: string;
  excelFile: DriveFile | null;
  images: DriveFile[];
};

export async function runProductImport(options: {
  folderId: string;
  tempDir?: string;
}): Promise<RunProductImportResult> {
  const tempDir = options.tempDir ?? path.join(os.tmpdir(), `ivory-import-${Date.now()}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const adminApp = getFirebaseAdmin();
  const db = adminApp.firestore();
  const bucket = adminApp.storage().bucket();
  const auth = getGoogleAuth();
  const drive = google.drive({ version: "v3", auth: auth as Parameters<typeof google.drive>[0]["auth"] });

  const stats: RunProductImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errored: 0,
    total: 0,
    errors: [],
    driveSyncErrors: [],
  };

  console.log("[import-products] run start", {
    folderId: options.folderId,
    tempDir,
    productConcurrency: PRODUCT_IMPORT_CONCURRENCY,
    imageConcurrency: PRODUCT_IMPORT_IMAGE_CONCURRENCY,
    at: new Date().toISOString(),
  });

  const files = await listDriveFiles(drive, options.folderId);
  const productMap = new Map<string, ProductImportGroup>();

  for (const file of files) {
    const productId = extractProductId(file.name);
    if (!productMap.has(productId)) {
      productMap.set(productId, { productId, excelFile: null, images: [] });
    }
    const entry = productMap.get(productId)!;
    const mime = file.mimeType || "";
    if (
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mime === "application/vnd.ms-excel" ||
      mime === "application/vnd.google-apps.spreadsheet"
    ) {
      entry.excelFile = file;
    } else if (mime.startsWith("image/")) {
      entry.images.push(file);
    }
  }

  stats.total = productMap.size;
  console.log("[import-products] Drive listing done", {
    driveFileCount: files.length,
    productGroups: stats.total,
  });

  const processProductGroup = async (
    product: ProductImportGroup
  ): Promise<{
    status: ImportProductResult;
    productId: string;
    error?: string;
    driveSyncErrors: { productId: string; error: string }[];
  }> => {
    const { productId } = product;
    let excelPath: string | null = null;
    const imagePaths: DownloadedAssetImage[] = [];
    const productDriveSyncErrors: { productId: string; error: string }[] = [];

    try {
      const productTempDir = validateAndSanitizePath(sanitizeFileName(productId), tempDir);
      if (!fs.existsSync(productTempDir)) fs.mkdirSync(productTempDir, { recursive: true });

      if (product.excelFile) {
        const safeName = sanitizeFileName(product.excelFile.name) || `${productId}.xlsx`;
        const relPath = path.join(sanitizeFileName(productId), safeName);
        excelPath = validateAndSanitizePath(relPath, tempDir);
        const excelDir = path.dirname(excelPath);
        if (!fs.existsSync(excelDir)) fs.mkdirSync(excelDir, { recursive: true });
        await downloadFileToPath(
          drive,
          product.excelFile.id,
          excelPath,
          product.excelFile.mimeType
        );
      }

      const downloadedImages = await mapConcurrent<DriveFile, DownloadedAssetImage | null>(
        product.images,
        PRODUCT_IMPORT_IMAGE_CONCURRENCY,
        async (imgFile, imgIndex) => {
          try {
            const safeName = sanitizeFileName(imgFile.name) || "image";
            const relPath = path.join(sanitizeFileName(productId), `${imgIndex}-${safeName}`);
            const imgPath = validateAndSanitizePath(relPath, tempDir);
            const imgDir = path.dirname(imgPath);
            if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
            await downloadFileToPath(drive, imgFile.id, imgPath, imgFile.mimeType);
            return {
              path: imgPath,
              name: imgFile.name,
              driveFileId: imgFile.id,
              ...(imgFile.mimeType ? { mimeType: imgFile.mimeType } : {}),
            };
          } catch (err) {
            console.error("[import-products] Image download failed", { productId, imgIndex, err });
            return null;
          }
        }
      );
      imagePaths.push(
        ...downloadedImages.filter((img): img is DownloadedAssetImage => Boolean(img))
      );

      const result = await processProduct(db, bucket, excelPath, productId, imagePaths);
      console.log("[import-products] product", {
        productId,
        status: result.status,
        hasExcel: !!product.excelFile,
        imageCount: imagePaths.length,
        ...(result.error ? { error: result.error } : {}),
      });

      if (result.status === "CREATE" || result.status === "UPDATE") {
        try {
          await syncProductAssetsToDrive(
            drive,
            options.folderId,
            productId,
            excelPath,
            product.excelFile,
            imagePaths,
            productDriveSyncErrors
          );
        } catch (err) {
          console.error("[import-products] Drive sync unexpected error", { productId, err });
          productDriveSyncErrors.push({
            productId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { ...result, driveSyncErrors: productDriveSyncErrors };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[import-products] product failed (before/after Firestore)", {
        productId,
        error: msg,
      });
      return {
        status: "ERRORED",
        productId,
        error: msg,
        driveSyncErrors: productDriveSyncErrors,
      };
    } finally {
      try {
        if (excelPath && fs.existsSync(excelPath)) fs.unlinkSync(excelPath);
        for (const img of imagePaths) {
          if (fs.existsSync(img.path)) fs.unlinkSync(img.path);
        }
      } catch (cleanupErr) {
        console.warn("[import-products] Cleanup failed", cleanupErr);
      }
    }
  };

  const outcomes = await mapConcurrent(
    Array.from(productMap.values()),
    PRODUCT_IMPORT_CONCURRENCY,
    processProductGroup
  );

  for (const outcome of outcomes) {
    switch (outcome.status) {
      case "CREATE":
        stats.created++;
        break;
      case "UPDATE":
        stats.updated++;
        break;
      case "SKIP":
        stats.skipped++;
        break;
      case "ERRORED":
        stats.errored++;
        if (outcome.error) stats.errors.push({ productId: outcome.productId, error: outcome.error });
        break;
    }
    stats.driveSyncErrors.push(...outcome.driveSyncErrors);
  }

  try {
    const dirContents = fs.readdirSync(tempDir, { withFileTypes: true });
    for (const d of dirContents) {
      if (d.isDirectory()) {
        const sub = path.join(tempDir, d.name);
        const filesInSub = fs.readdirSync(sub);
        for (const f of filesInSub) {
          fs.unlinkSync(path.join(sub, f));
        }
        fs.rmdirSync(sub);
      }
    }
  } catch {
    // leave temp dir for OS to clean
  }

  console.log("[import-products] run complete", {
    ...stats,
    at: new Date().toISOString(),
  });

  return stats;
}
