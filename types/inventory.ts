export type Product = {
  id: string;
  name: string;
  cost: number; // unit cost price
  price: number; // unit sale price
  stock: number; // current quantity in inventory
};

export type InventoryMetrics = {
  totalCostValue: number; // sum(cost * stock)
  totalSaleValue: number; // sum(price * stock)
  potentialProfit: number; // totalSaleValue - totalCostValue
};

export type InventoryContextValue = {
  products: Product[];
  sellProduct: (productId: string, quantity: number) => { success: boolean; error?: string };
  purchaseProduct: (productId: string, quantity: number, costOverride?: number) => void;
  addProduct: (product: Omit<Product, 'id'>) => string; // returns new id
  getMetrics: () => InventoryMetrics;
};