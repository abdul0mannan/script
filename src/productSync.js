const { info, warn, error } = require("./logger");
const { callShopifyGraphQL, fetchProductByHandle, setInventoryQuantities } = require("./shopifyClient");
const { getConfig } = require('./config');
const CONFIG = getConfig(); 

const PRODUCT_SET_MUTATION = `
  mutation upsertProductFromExcel(
    $identifier: ProductSetIdentifiers
    $input: ProductSetInput!
  ) {
    productSet(identifier: $identifier, input: $input) {
      product {
        id
        handle
        title
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

function parseTags(tagsString) {
  if (!tagsString) return [];
  return String(tagsString)
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function mapStatus(raw) {
  if (!raw) return "ACTIVE"; // default
  const s = String(raw).trim().toUpperCase();
  if (["ACTIVE", "DRAFT", "ARCHIVED", "UNLISTED"].includes(s)) {
    return s;
  }
  return "ACTIVE";
}

function buildProductSetInput(
  handle,
  productRowsForHandle,
  existingProduct,
  imagesForHandle,
  metafieldsForHandle
) {
  const firstRow = productRowsForHandle[0];

  const title = String(firstRow.ProductTitle || "").trim();
  const descriptionHtml = String(firstRow.ProductDescriptionHtml || "");
  const productType = String(firstRow.ProductType || "").trim();
  const vendor = String(firstRow.Vendor || "").trim();
  const tags = parseTags(firstRow.Tags);
  const status = mapStatus(firstRow.Status);

  const uniqueVariantTitles = Array.from(
    new Set(
      productRowsForHandle
        .map((r) => String(r.VariantTitle || "").trim())
        .filter((v) => v.length > 0)
    )
  );

  const productOptions =
    uniqueVariantTitles.length > 0
      ? [
          {
            name: "Title",
            values: uniqueVariantTitles.map((name) => ({ name })),
          },
        ]
      : [];

  const existingVariantsBySku = new Map();
  if (
    existingProduct &&
    existingProduct.variants &&
    existingProduct.variants.nodes
  ) {
    for (const v of existingProduct.variants.nodes) {
      if (v.sku) {
        existingVariantsBySku.set(v.sku, v);
      }
    }
  }

  const variants = productRowsForHandle.map((row, idx) => {
    const sku = String(row.VariantSKU || "").trim();
    const variantTitle = String(row.VariantTitle || "").trim();
    const priceRaw = row.VariantPrice;
    const compareAtRaw = row.VariantCompareAtPrice;
    const qtyRaw = row.VariantInventoryQuantity;
    const existing = sku ? existingVariantsBySku.get(sku) : null;
    let inventoryQuantities;
    if (CONFIG.defaultLocationId && qtyRaw !== undefined && qtyRaw !== "") {
      const qty = Number(qtyRaw);
      if (!Number.isNaN(qty)) {
        inventoryQuantities = [
          {
            locationId: CONFIG.defaultLocationId,
            name: "available", 
            quantity: qty,
          },
        ];
      }
    }
    const variantInput = {
      ...(existing && existing.id ? { id: existing.id } : {}),
      sku: sku || undefined,
      price:
        priceRaw !== undefined && priceRaw !== ""
          ? Number(priceRaw)
          : undefined,
      compareAtPrice:
        compareAtRaw !== undefined && compareAtRaw !== ""
          ? Number(compareAtRaw)
          : undefined,

      optionValues: variantTitle
        ? [
            {
              optionName: "Title",
              name: variantTitle,
            },
          ]
        : [],
      barcode: row.VariantBarcode ? String(row.VariantBarcode) : undefined,
      taxable:
        String(row.VariantTaxable || "")
          .trim()
          .toUpperCase() === "TRUE"
          ? true
          : undefined,
      inventoryItem: {
        tracked: true,
      },
    };

    return variantInput;
  });

  const metafields =
    (metafieldsForHandle || []).map((m) => ({
      namespace: String(m.Namespace || "").trim(),
      key: String(m.Key || "").trim(),
      type: String(m.Type || "").trim(),
      value: String(m.Value || ""),
    })) || [];

    const files =
    (imagesForHandle || []).map((img) => {
      const src = String(img.ImageSrc || '').trim();
      if (!src) return null;
  
      const urlParts = src.split('/');
      const lastPart = urlParts[urlParts.length - 1] || '';
      const filename = lastPart || 'image.jpg';
  
    
      return {
        originalSource: src,
        filename
      };
    }).filter(Boolean) || [];
  
      

  const input = {
    title,
    handle,
    descriptionHtml,
    productType: productType || undefined,
    vendor: vendor || undefined,
    tags,
    status,
    productOptions,
    variants,
    metafields: metafields.length > 0 ? metafields : undefined,
    files: files.length > 0 ? files : undefined,
  };
 
  return input;
}

async function syncInventoryForProduct(handle, productRowsForHandle) {
    if (!CONFIG.defaultLocationId) {
      warn(
        `No SHOPIFY_DEFAULT_LOCATION_ID configured. Skipping inventory sync for "${handle}".`
      );
      return;
    }
  
    const product = await fetchProductByHandle(handle);
    if (!product) {
      warn(`Cannot sync inventory: product "${handle}" not found after upsert.`);
      return;
    }
  
    const variants = product.variants?.nodes || [];
    const inventoryItemIdBySku = new Map();
  
    for (const v of variants) {
      if (v.sku && v.inventoryItem && v.inventoryItem.id) {
        inventoryItemIdBySku.set(v.sku, v.inventoryItem.id);
      }
    }
  
    const quantities = [];
  
    for (const row of productRowsForHandle) {
      const sku = String(row.VariantSKU || '').trim();
      const qtyRaw = row.VariantInventoryQuantity;
  
      if (!sku) continue;
      if (qtyRaw === undefined || qtyRaw === '') continue;
  
      const qty = Number(qtyRaw);
      if (Number.isNaN(qty)) continue;
  
      const invItemId = inventoryItemIdBySku.get(sku);
      if (!invItemId) {
        warn(
          `No inventoryItem found for SKU "${sku}" on product "${handle}". Skipping inventory line.`
        );
        continue;
      }
  
      quantities.push({
        inventoryItemId: invItemId,
        locationId: CONFIG.defaultLocationId,
        quantity: qty
      });
    }
  
    if (quantities.length === 0) {
      info(`No inventory rows to sync for product "${handle}".`);
      return;
    }
  
    info(
      `Setting inventory for product "${handle}" at location ${CONFIG.defaultLocationId} for ${quantities.length} variant(s).`
    );
  
    await setInventoryQuantities({
      name: 'available',           
      reason: 'correction',        
      ignoreCompareQuantity: true, 
      quantities
    });
  }
  
async function syncAllProductsFromExcel(
  { productsByHandle, imagesByHandle, metafieldsByHandle },
  { dryRun = false } = {}
) {
  for (const [handle, productRowsForHandle] of productsByHandle.entries()) {
    info(`\n=== Syncing product "${handle}" ===`);
    const imagesForHandle = imagesByHandle.get(handle) || [];
    const metafieldsForHandle = metafieldsByHandle.get(handle) || [];

    const existingProduct = await fetchProductByHandle(handle);

    const productInput = buildProductSetInput(
      handle,
      productRowsForHandle,
      existingProduct,
      imagesForHandle,
      metafieldsForHandle
    );

    if (dryRun) {
      info(`[DRY RUN] Would upsert product with handle "${handle}"`);
      info(
        `[DRY RUN] Variants count: ${
          productInput.variants ? productInput.variants.length : 0
        }, files (images): ${
          productInput.files ? productInput.files.length : 0
        }, metafields: ${
          productInput.metafields ? productInput.metafields.length : 0
        }`
      );
      continue;
    }

    try {
      const variables = {
        identifier: {
          handle,
        },
        input: productInput,
      };

      const data = await callShopifyGraphQL(PRODUCT_SET_MUTATION, variables);
      const payload = data?.data?.productSet;

    

      if (!payload) {
        error(
          `productSet returned no payload for handle "${handle}". Raw: ${JSON.stringify(
            data
          )}`
        );
        continue;
      }

      if (payload.userErrors && payload.userErrors.length > 0) {
        error(
          `productSet userErrors for handle "${handle}": ${JSON.stringify(
            payload.userErrors,
            null,
            2
          )}`
        );
        continue;
      }

      const product = payload.product;
      if (product) {
        info(
          `Upserted product: id=${product.id}, handle=${product.handle}, title="${product.title}"`
        );
        await syncInventoryForProduct(handle, productRowsForHandle);
      } else {
        warn(
          `productSet succeeded but returned no product for handle "${handle}".`
        );
      }
    } catch (e) {
      error(`Failed to upsert product "${handle}": ${e.message}`);
    }
  }

  info("\nAll products processed.");
}

module.exports = {
  syncAllProductsFromExcel,
};
