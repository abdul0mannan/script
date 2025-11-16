const xlsx = require("xlsx");
const { info, warn, error } = require("./logger");

const REQUIRED_PRODUCT_COLUMNS = [
  "ProductHandle",
  "ProductTitle",
  "ProductDescriptionHtml",
  "ProductType",
  "Vendor",
  "Tags",
  "VariantSKU",
  "VariantTitle",
  "VariantPrice",
];

const OPTIONAL_PRODUCT_COLUMNS = [
  "Status",
  "VariantCompareAtPrice",
  "VariantInventoryQuantity",
  "VariantBarcode",
  "VariantTaxable",
  "VariantRequiresShipping",
];

const REQUIRED_IMAGE_COLUMNS = ["ProductHandle", "ImageSrc"];

const OPTIONAL_IMAGE_COLUMNS = ["ImageAltText", "ImagePosition"];

const REQUIRED_METAFIELD_COLUMNS = [
  "ProductHandle",
  "Namespace",
  "Key",
  "Type",
  "Value",
];

function readSheetAsJson(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    warn(`Sheet "${sheetName}" not found in the workbook`);
    return [];
  }
  const data = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  return data;
}

function validateColumns(rows, requiredColumns, sheetName) {
  if (!rows || rows.length === 0) {
    warn(`No data found in the "${sheetName}" sheet`);
    return;
  }

  const firstRow = rows[0];
  const missing = requiredColumns.filter((col) => !(col in firstRow));
  if (missing.length > 0) {
    throw new Error(
      `Missing required columns in the "${sheetName}" sheet: ${missing.join(
        ", "
      )}`
    );
  }
}

function groupProductsByHandle(productRows) {
  const productsByHandle = new Map();

  for (const row of productRows) {
    const handle = String(row.ProductHandle || "").trim();
    if (!handle) {
      warn(`Skipping row with missing ProductHandle: ${JSON.stringify(row)}`);
      continue;
    }
    if (!productsByHandle.has(handle)) {
      productsByHandle.set(handle, []);
    }
    productsByHandle.get(handle).push(row);
  }
  return productsByHandle;
}

function groupImageByHandle(imageRows) {
  const imagesByHandle = new Map();
  for (const row of imageRows) {
    const handle = String(row.ProductHandle || "").trim();
    const src = String(row.ImageSrc || "").trim();
    if (!handle || !src) {
      warn(
        `Skipping row with missing ProductHandle or ImageSrc: ${JSON.stringify(
          row
        )}`
      );
      continue;
    }
    if (!imagesByHandle.has(handle)) {
      imagesByHandle.set(handle, []);
    }
    imagesByHandle.get(handle).push(row);
  }
  return imagesByHandle;
}

function groupMetafieldByHandle(metafieldRows) {
  const metafieldsByHandle = new Map();
  for (const row of metafieldRows) {
    const handle = String(row.ProductHandle || "").trim();
    const ns = String(row.Namespace || "").trim();
    const key = String(row.Key || "").trim();
    const type = String(row.Type || "").trim();

    if (!handle || !ns || !key || !type) {
      warn(
        `Skipping row with missing ProductHandle, Namespace, Key, or Type: ${JSON.stringify(
          row
        )}`
      );
      continue;
    }
    if (!metafieldsByHandle.has(handle)) {
      metafieldsByHandle.set(handle, []);
    }
    metafieldsByHandle.get(handle).push(row);
  }
  return metafieldsByHandle;
}

function parseExcelFile(filePath) {
  info(`Reading Excel file: ${filePath}`);

  const workbook = xlsx.readFile(filePath);

  const productRows = readSheetAsJson(workbook, "Products");

  if (productRows.length === 0) {
    throw new Error('No product data found in the "Products" sheet');
  }

  validateColumns(productRows, REQUIRED_PRODUCT_COLUMNS, "Products");

  const productsByHandle = groupProductsByHandle(productRows);

  info(`Found ${productsByHandle.size} unique product handles`);

  const imageRows = readSheetAsJson(workbook, "Images");

  if (imageRows.length > 0) {
    validateColumns(imageRows, REQUIRED_IMAGE_COLUMNS, "Images");
  }

  const imagesByHandle = groupImageByHandle(imageRows);

  if (imagesByHandle.size > 0) {
    info(`Found ${imagesByHandle.size} unique product handles with images`);
  }

  const metafieldRows = readSheetAsJson(workbook, "Metafields");

  if (metafieldRows.length > 0) {
    validateColumns(metafieldRows, REQUIRED_METAFIELD_COLUMNS, "Metafields");
  }

  const metafieldsByHandle = groupMetafieldByHandle(metafieldRows);

  if (metafieldsByHandle.size > 0) {
    info(
      `Found ${metafieldsByHandle.size} unique product handles with metafields`
    );
  }
  const totalVariantRows = productRows.length;
  info("Excel file parsing completed successfully");

  info(`Total variant rows processed: ${totalVariantRows}`);
  return {
    productsByHandle,
    imagesByHandle,
    metafieldsByHandle,
    productRows,
    imageRows,
    metafieldRows,
  };
}

module.exports = { parseExcelFile };
