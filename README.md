## Shopify Excel Product Sync (Node.js)

**Description**  
This is a Node.js command‑line tool that reads an Excel workbook (`.xlsx`) and creates or updates Shopify products using the **Admin GraphQL API**.  
It supports core product fields, variants, pricing, and (bonus) images and metafields, and is designed to be safe to run multiple times without creating duplicate variants.

---

## Features

- **Authentication**: Uses a private/custom app Admin API access token (GraphQL).
- **Excel‑driven**: Reads product, image, and metafield data from an `.xlsx` file.
- **Upsert behavior**:
  - Finds products by **handle** (`productByHandle`).
  - Reuses variant IDs based on **SKU** to update variants instead of creating duplicates.
- **Core product fields**:
  - Product: title, description HTML, productType, vendor, tags, status.
  - Variant: SKU, title, price, compare‑at price, inventory quantity, barcode, taxable.
- **Bonus support**:
  - **Images**: Adds product images from URLs in the Excel file.
  - **Metafields**: Creates/updates metafields for products.
- **Inventory sync**:
  - Sets on‑hand inventory per variant at a given Shopify Location via `inventorySetQuantities`.
- **Idempotent‑ish**:
  - Running the script multiple times updates existing products/variants rather than duplicating them.
- **Rate limiting aware**:
  - Handles Shopify GraphQL throttling and HTTP 429 with retry and exponential backoff.

---

## Project Structure

- `src/index.js`  
  CLI entrypoint. Parses CLI arguments (`--file`, `--dry-run`), loads config, parses the Excel file, and triggers the sync.

- `src/config.js`  
  Loads and validates required environment variables:
  - `SHOPIFY_STORE_DOMAIN`
  - `SHOPIFY_ACCESS_TOKEN`
  - `SHOPIFY_API_VERSION`
  - `SHOPIFY_DEFAULT_LOCATION_ID`

- `src/excelParser.js`  
  Reads the Excel workbook using `xlsx`, validates required columns, and groups rows by `ProductHandle`. Returns:
  - `productsByHandle`
  - `imagesByHandle`
  - `metafieldsByHandle`

- `src/shopifyClient.js`  
  Shopify GraphQL client built on `axios`:
  - Initializes the GraphQL endpoint with your store domain, API version, and access token.
  - `callShopifyGraphQL(query, variables)` handles throttling and retries on 429.
  - `fetchProductByHandle(handle)` queries an existing product and its variants.
  - `setInventoryQuantities(input)` calls `inventorySetQuantities` to set inventory.

- `src/productSync.js`  
  Business logic for building the `ProductSetInput` payload and orchestrating the sync:
  - Builds product + variant + image + metafield payloads from grouped Excel rows.
  - Upserts products via the `productSet` mutation keyed by handle.
  - After a successful upsert, explicitly syncs inventory via `inventorySetQuantities`.

- `src/logger.js`  
  Simple logging helpers (`info`, `warn`, `error`) wrapping `console`.

- `products_template.xlsx`  
  **Sample Excel file** you can use as a starting point for your own data. See the format details below.

- `env.example`  
  Sample environment configuration file; copy this to `.env` and fill in your own credentials.

---

## Setup

### 1. Install dependencies

From the project root:

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root. You can start by copying `env.example`:

```bash
cp env.example .env
```

Then edit `.env` and set your values:

```env
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpca_xxxxxxxxxxxxxxxxxxxx
SHOPIFY_DEFAULT_LOCATION_ID=gid://shopify/Location/xxxxxxxx
SHOPIFY_API_VERSION=2025-10
```

- **`SHOPIFY_STORE_DOMAIN`**: Your store domain (e.g. `mystore.myshopify.com`).
- **`SHOPIFY_ACCESS_TOKEN`**: Admin API access token from a private/custom app.
- **`SHOPIFY_DEFAULT_LOCATION_ID`**: Location ID used for inventory updates.
- **`SHOPIFY_API_VERSION`**: Admin API version (e.g. `2025-10`).

> All of these are required; if any are missing, the script will throw an error at startup.

---

## Sample Excel File Format (`products_template.xlsx`)

The script expects an `.xlsx` workbook with up to **three sheets**:

### 1. `Products` sheet (required)

Each row in `Products` represents a **variant** of a product. Products are grouped by `ProductHandle`.

- **Required columns**:
  - `ProductHandle`
  - `ProductTitle`
  - `ProductDescriptionHtml`
  - `ProductType`
  - `Vendor`
  - `Tags`
  - `VariantSKU`
  - `VariantTitle`
  - `VariantPrice`

- **Optional columns**:
  - `Status` (`ACTIVE`, `DRAFT`, `ARCHIVED`, or `UNLISTED`; defaults to `ACTIVE`)
  - `VariantCompareAtPrice`
  - `VariantInventoryQuantity`
  - `VariantBarcode`
  - `VariantTaxable` (`TRUE` → taxable)
  - `VariantRequiresShipping`

### 2. `Images` sheet (optional)

- **Required columns**:
  - `ProductHandle`
  - `ImageSrc` (public image URL)

- **Optional columns**:
  - `ImageAltText`
  - `ImagePosition`

### 3. `Metafields` sheet (optional)

- **Required columns**:
  - `ProductHandle`
  - `Namespace`
  - `Key`
  - `Type`
  - `Value`

> The provided `products_template.xlsx` file already contains these sheets and columns so you can plug in your own data.

---

## Usage

From the project root, after configuring `.env` and preparing your Excel file:

### Dry run (validate without changing Shopify)

```bash
node src/index.js --file ./products_template.xlsx --dry-run
```

This will:

- Read and validate the Excel file.
- Log how many products, images, and metafields will be processed.
- Show a summary of planned operations.
- **Not** send any requests to Shopify.

### Real sync (create/update products)

```bash
node src/index.js --file ./products_template.xlsx
```

Or using the npm script:

```bash
npm start -- --file ./products_template.xlsx
```

The script will:

- Parse and validate the Excel workbook.
- For each unique `ProductHandle`:
  - Fetch the existing product by handle (if any).
  - Build a `ProductSetInput` payload from the Excel rows.
  - Upsert the product via the `productSet` GraphQL mutation.
  - Sync inventory quantities for each variant at `SHOPIFY_DEFAULT_LOCATION_ID`.

Logs will be printed to the console with `[INFO]`, `[WARN]`, and `[ERROR]` prefixes.

---

## How It Avoids Duplicates

- **Products**: Identified by `handle` via `productByHandle`, then upserted with `productSet` using `identifier.handle`.  
- **Variants**:
  - Existing variants are loaded and indexed by `sku`.
  - When building variant inputs, the script includes the existing variant `id` for matching SKUs.
  - Shopify will update these variants instead of creating new ones, so re-running the script updates data rather than duplicating variants.

> Images and metafields are attached via the product `files` and `metafields` fields respectively. Shopify will handle how duplicate image URLs/metafields are treated.

---



