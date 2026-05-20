export type ProductRow = {
  productId: string;
  name: string;
  category: string;
  tags: string[];
  isActive: boolean;
  updatedAt: string | null;
};

export type ProductData = {
  productId?: string;
  category?: string;
  tags?: string[];
  materials?: string[];
  isActive?: boolean;
  stoneSummary?: unknown;
  assumingNetWt?: number | null;
  imageUrls?: string[];
};

export type ProductRowsData = {
  rows: unknown[];
  updatedAt: string | null;
};

/** GET /api/admin/products/[productId] response: product document plus rows subcollection */
export type ProductWithRows = ProductData & {
  rows: unknown[] | null;
  rowsUpdatedAt: string | null;
};

export type ProductImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  total: number;
  errors: { productId: string; error: string }[];
  /** Failures writing Excel/images back to Drive (Firestore import still succeeded). */
  driveSyncErrors: { productId: string; error: string }[];
};

export type ImportProductResult = "CREATE" | "UPDATE" | "SKIP" | "ERRORED";
