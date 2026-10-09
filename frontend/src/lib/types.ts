export type ColorMode = "BW" | "COLOR";
export type Sides = "SINGLE" | "DOUBLE";
export type PaperFormat = "A4" | "A3";
export type FinishingCode = "NONE" | "SPIRAL" | "STAPLE" | "HARDCOVER";
export type PricingUnit = "PER_FACE" | "PER_SHEET";
export type Role = "CUSTOMER" | "DELEGATE" | "OPERATOR" | "ADMIN";
export type OrderStatus =
  | "DRAFT"
  | "PENDING_PAYMENT"
  | "PAID"
  | "TO_PREPARE"
  | "PRINTING"
  | "FINISHING"
  | "READY_FOR_PICKUP"
  | "OUT_FOR_DELIVERY"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED";
export type PaymentState = "UNPAID" | "PENDING" | "PAID" | "REFUNDED";
export type DocumentStatus = "PENDING_UPLOAD" | "UPLOADED" | "ANALYZING" | "READY" | "NEEDS_REVIEW" | "FAILED" | "REJECTED" | "DELETED";
export type PaymentStatus = "CREATED" | "PENDING" | "SUCCESSFUL" | "FAILED" | "EXPIRED" | "CANCELLED" | "PENDING_VERIFICATION" | "REJECTED";
export type GroupStatus = "OPEN" | "CLOSED" | "IN_PRODUCTION" | "READY" | "COMPLETED" | "CANCELLED";
export type GroupMode = "DELEGATE_COLLECT" | "STUDENT_CONTRIBUTIONS";

export interface PrintOptions {
  colorMode: ColorMode;
  sides: Sides;
  paperFormat: PaperFormat;
  finishingCode: FinishingCode;
  copies: number;
}

export interface User {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  delegate: null | { status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED"; institution: string; field: string; level: string; className: string; reviewNote: string | null };
  profile: null | { quarter: string | null; addressDetails: string | null; notifyByEmail: boolean };
}

export interface ApiDocument {
  id: string;
  originalName: string;
  extension: string;
  kind: "PDF" | "DOC" | "DOCX" | "JPEG" | "PNG" | null;
  sizeBytes: number;
  pageCount: number | null;
  pageCountSource: "DETECTED" | "IMAGE_DEFAULT" | "CUSTOMER_DECLARED" | "STAFF_SET" | null;
  status: DocumentStatus;
  analysisError: string | null;
  hasPdfVersion: boolean;
  createdAt: string;
}

export interface UploadTarget {
  method: "POST";
  url: string;
  fields: Record<string, string>;
  expiresAt: string;
}

export interface PublicConfig {
  uploads: { maxFileSizeMb: number; maxFilesPerOrder: number; maxTotalSizeMb: number; acceptedExtensions: string[] };
  pickupPoints: { id: string; name: string; address: string; hours: string | null; phone: string | null; isDefault: boolean }[];
  delivery: { enabled: boolean; defaultFee: number | null; zones: { id: string; name: string; fee: number }[] };
  pricing: {
    rules: { colorMode: ColorMode; sides: Sides; paperFormat: PaperFormat; unitPrice: number | null; unit: PricingUnit; available: boolean }[];
    finishings: { code: FinishingCode; label: string; price: number }[];
  };
  services: { id: string; code: string; name: string; description: string; pricingMode: "QUOTE" | "PRINT_FLOW" }[];
  payments: { enabled: boolean; provider: "FAPSHI" | "MOCK" | null; environment: "LIVE" | "SANDBOX" | null; testMode: boolean; directPay: boolean; minAmount: number };
  pickupPolicy: string;
  support: { whatsapp: string; whatsappLink: string };
  features: { email: boolean; whatsappNotifications: boolean };
}

export interface ItemPrice {
  pageCount: number;
  copies: number;
  sheetsPerCopy: number;
  sheets: number;
  faces: number;
  unitPrice: number;
  pricingUnit: PricingUnit;
  printCost: number;
  finishingCode: FinishingCode;
  finishingLabel: string;
  finishingUnitPrice: number;
  finishingCost: number;
  lineTotal: number;
}

export interface EstimateResponse {
  items: { key?: string; documentId?: string; price?: ItemPrice; error?: { code: string; message: string } }[];
  totals: { subtotal: number; deliveryFee: number | null; total: number | null; totalPages: number; totalSheets: number; totalFaces: number };
  delivery: { fee: number | null; zoneId: string | null; zoneName: string | null };
  complete: boolean;
}

export interface Payment {
  id: string;
  orderId?: string;
  provider: "FAPSHI" | "MOCK" | "CASH";
  method: "FAPSHI_CHECKOUT" | "FAPSHI_DIRECT" | "CASH_DECLARATION";
  environment: "LIVE" | "SANDBOX" | "OFFLINE";
  status: PaymentStatus;
  amount: number;
  medium: string | null;
  paymentLink?: string | null;
  failureReason: string | null;
  isDuplicate: boolean;
  providerTransId?: string | null;
  declarationNote?: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface OrderItem {
  id: string;
  kind: "PRINT" | "SERVICE";
  documentId?: string | null;
  documentName: string | null;
  description: string | null;
  documentAvailable: boolean;
  pageCountSource: ApiDocument["pageCountSource"];
  documentKind: ApiDocument["kind"];
  pageCount: number;
  sheets: number;
  faces: number;
  copies: number;
  options: PrintOptions | null;
  unitPrice: number;
  pricingUnit: PricingUnit | null;
  printCost: number;
  finishingUnitPrice: number;
  finishingCost: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  reference: string;
  type: "STANDARD" | "GROUP" | "SERVICE";
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: PaymentState;
  fulfillmentMethod: "PICKUP" | "DELIVERY";
  subtotal: number;
  deliveryFee: number | null;
  total: number | null;
  amountPaid: number;
  currency: string;
  notes: string | null;
  trackingToken?: string;
  pickupCode?: string;
  creditApproved: boolean;
  creditReason?: string | null;
  canPay: boolean;
  paymentBlockedReason: string | null;
  customer?: { id?: string; fullName: string; phone?: string; email?: string | null };
  pickupPoint: { id: string; name: string; address: string; hours: string | null } | null;
  delivery: null | {
    recipientName: string;
    phone: string;
    quarter: string;
    directions: string | null;
    zone: { id: string; name: string } | null;
    fee: number | null;
    status: string;
    deliveredAt: string | null;
    receivedBy?: string | null;
    proofNote?: string | null;
  };
  pickup: null | {
    status: string;
    readyAt: string | null;
    pickedUpAt: string | null;
    pickedUpBy?: string | null;
    verifiedWithCode: boolean;
    rescheduledTo: string | null;
    note?: string | null;
  };
  items: OrderItem[];
  payments: Payment[];
  refunds: { id: string; amount: number; method: string; reference: string | null; note: string | null; createdAt: string }[];
  history: { status: OrderStatus; label: string; note?: string | null; createdAt: string }[];
  group: { id: string; code: string; name: string; mode: GroupMode; status: GroupStatus } | null;
  quote: { id: string; reference: string; service: string } | null;
  createdAt: string;
  confirmedAt: string | null;
  paidAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface OrderSummary {
  id: string;
  reference: string;
  type: Order["type"];
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: PaymentState;
  fulfillmentMethod: "PICKUP" | "DELIVERY";
  total: number | null;
  itemsCount: number;
  pagesCount: number;
  firstDocument: string | null;
  colorMode: ColorMode | null;
  group: { id: string; name: string; code: string } | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface Group {
  id: string;
  code: string;
  shareToken: string;
  name: string;
  institution: string;
  field: string;
  level: string;
  className: string;
  category: string | null;
  instructions: string | null;
  mode: GroupMode;
  status: GroupStatus;
  statusLabel: string;
  productionRule: "FULL_PAYMENT" | "PAID_ONLY";
  productionOverride: boolean;
  deadline: string | null;
  closedAt: string | null;
  productionStartedAt: string | null;
  createdAt: string;
  delegate: { id: string; fullName: string };
  pickupPoint: { id: string; name: string; address: string } | null;
  defaultOptions: PrintOptions | null;
  totals: {
    contributionsCount: number;
    contributorsCount: number;
    confirmedCount: number;
    paidCount: number;
    unpaidCount: number;
    documentsCount: number;
    pagesCount: number;
    sheetsCount: number;
    totalAmount: number;
    paidAmount: number;
    pendingDeliveryFee: boolean;
  };
  productionReady: boolean;
  productionBlockedReason: string | null;
  contributions: {
    id: string;
    contributor: { id?: string; fullName: string };
    isDelegate: boolean;
    order: {
      id: string;
      reference: string;
      status: OrderStatus;
      statusLabel: string;
      paymentStatus: PaymentState;
      creditApproved: boolean;
      total: number | null;
      amountPaid: number;
      documents: { name: string | null; pageCount: number; copies: number }[];
    };
    createdAt: string;
  }[];
}

export interface Quote {
  id: string;
  reference: string;
  service: { code: string; name: string };
  description: string;
  deadline: string | null;
  status: "REQUESTED" | "QUOTED" | "ACCEPTED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  statusLabel: string;
  amount: number | null;
  lines: { label: string; quantity: number; unitPrice: number }[];
  adminMessage: string | null;
  validUntil: string | null;
  quotedAt: string | null;
  documents: ApiDocument[];
  customer?: { id: string; fullName: string; phone: string; email: string | null };
  order: { id: string; reference: string; status: OrderStatus; paymentStatus: PaymentState } | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
