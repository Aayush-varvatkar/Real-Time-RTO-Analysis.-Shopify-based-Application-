import '@shopify/ui-extensions';

// @ts-expect-error: Module declaration for Action.jsx
declare module './src/Action.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.product-details.action.render').Api;
  const globalThis: { shopify: typeof shopify };
}

// @ts-expect-error: Module declaration for MenuItem.jsx
declare module './src/MenuItem.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.product-details.action.menu-item.render').Api;
  const globalThis: { shopify: typeof shopify };
}
