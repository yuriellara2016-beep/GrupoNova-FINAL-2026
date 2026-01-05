// Local domain types for the app. Remove any Convex dependencies to avoid web/runtime import issues.

export type UserRole = 'admin' | 'seller';

export type Store = {
  id: string;
  name: string;
  address?: string;
  active: boolean;
  createdAt: string; // ISO
};

// Product type used across lib/db and screens
export type Product = {
  id: string;
  name: string;
  sku: string | null;
  costPrice: number;
  sellPrice: number;
  quantity: number;
  chargeExtra10Percent: boolean;
  minStock?: number; // Minimum stock threshold for alerts
};

// Sales and related types (matching lib/db)
export type Sale = {
  id: string;
  createdAt: string; // ISO
  date?: string; // ISO date string for filtering
  paymentMethod: 'cash' | 'transfer' | 'mixed';
  subtotal: number;
  total: number;
  commission: number; // bank commission (1.5% of transfer portion) if applicable
  cashAmount?: number; // for mixed payment
  transferAmount?: number; // for mixed payment
  operationNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  storeId?: string | null;
  userId?: string | null;
  status?: 'active' | 'cancelled'; // for returns/cancellations
};

export type SaleItem = {
  id: string;
  saleId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  extra10PercentAmount?: number; // registered as expense, not charged to customer
};

// Expenses
export type Expense = {
  id: string;
  createdAt: string; // ISO
  type: 'operational' | 'other' | 'salary' | 'rent';
  amount: number;
  note?: string | null;
  storeId?: string | null;
  userId?: string | null; // User who created the expense (for sellers)
};

// Inventory entries (movements)
export type InventoryEntry = {
  id: string;
  createdAt: string; // ISO
  type: 'purchase' | 'transfer_in' | 'adjustment' | 'sale' | 'transfer_out';
  productId: string;
  quantity: number;
  unitCost: number;
  paymentMethod: null | 'cash';
  note?: string | null;
  storeId?: string | null;
  targetStoreId?: string | null; // for transfer_in
};

// Cash sessions (matching lib/db.ts usage)
export type CashSession = {
  id: string;
  openedAt: string; // ISO
  closedAt: string | null; // ISO or null
  startingBalance: number;
  endingBalance: number | null;
  note: string | null;
  storeId?: string | null;
};

// Transfer requests (for inventory transfer suggestions/approvals)
export type TransferRequest = {
  id: string;
  createdAt: string; // ISO
  productId: string;
  quantity: number;
  fromStoreId: string;
  toStoreId: string;
  status: 'pending' | 'approved' | 'rejected';
  suggestedBy: 'system' | 'user'; // auto-generated or manual
  note?: string | null;
  approvedBy?: string | null; // userId
  approvedAt?: string | null; // ISO
};