const dotenv = require("dotenv");

dotenv.config();

function getConfig() {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, SHOPIFY_API_VERSION, SHOPIFY_DEFAULT_LOCATION_ID } =
    process.env;

  const missing = [];
  if (!SHOPIFY_STORE_DOMAIN) missing.push("SHOPIFY_STORE_DOMAIN");
  if (!SHOPIFY_ACCESS_TOKEN) missing.push("SHOPIFY_ACCESS_TOKEN");
  if (!SHOPIFY_API_VERSION) missing.push("SHOPIFY_API_VERSION");
  if (!SHOPIFY_DEFAULT_LOCATION_ID) missing.push("SHOPIFY_DEFAULT_LOCATION_ID");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return {
    storeDomain: SHOPIFY_STORE_DOMAIN,
    accessToken: SHOPIFY_ACCESS_TOKEN,
    apiVersion: SHOPIFY_API_VERSION,
    defaultLocationId: SHOPIFY_DEFAULT_LOCATION_ID,
  };
}

module.exports = { getConfig };
