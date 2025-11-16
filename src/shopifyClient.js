const axios = require("axios");
const { getConfig } = require("./config");
const { info, warn, error } = require("./logger");

let axiosInstance = null;

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function initShopifyClient() {
  if (axiosInstance) return axiosInstance;

  const config = getConfig();
  const baseURL = `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`;

  axiosInstance = axios.create({
    baseURL,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.accessToken,
    },
    timeout: 30000,
  });

  return axiosInstance;
}

function extractThrottleInfo(data) {
  try {
    const cost = data?.extensions?.cost;
    if (!cost) return null;

    const throttle = cost.throttleStatus || {};
    const infoObj = {
      requestedQueryCost: cost.requestedQueryCost,
      actualQueryCost: cost.actualQueryCost,
      maximumAvailable: throttle.maximumAvailable,
      currentlyAvailable: throttle.currentlyAvailable,
      restoreRate: throttle.restoreRate,
    };

    return infoObj;
  } catch {
    return null;
  }
}

async function applyPreemptiveThrottleWait(throttleInfo) {
  if (!throttleInfo) return;

  const { currentlyAvailable, restoreRate } = throttleInfo;

  if (
    typeof currentlyAvailable !== "number" ||
    typeof restoreRate !== "number"
  ) {
    return;
  }

  const LOW_CREDITS_THRESHOLD = 50;

  if (currentlyAvailable < LOW_CREDITS_THRESHOLD) {
    const desired = LOW_CREDITS_THRESHOLD * 2;
    const deficit = Math.max(0, desired - currentlyAvailable);

    if (deficit > 0 && restoreRate > 0) {
      const secondsNeeded = deficit / restoreRate;
      const waitMs = Math.ceil(secondsNeeded * 1000);

      warn(
        `Low Shopify API credits (${currentlyAvailable}). ` +
          `Waiting ~${waitMs} ms to let the bucket refill.`
      );
      await sleep(waitMs);
    }
  }
}

async function callShopifyGraphQL(query, variables = {}) {
  const client = initShopifyClient();
  let attempt = 0;
  let backoffMs = INITIAL_BACKOFF_MS;

  while (attempt <= MAX_RETRIES) {
    attempt += 1;

    try {
      const response = await client.post("", {
        query,
        variables,
      });

      const data = response.data;

      if (data.errors && data.errors.length > 0) {
        error(`GraphQL errors: ${JSON.stringify(data.errors, null, 2)}`);
        return data;
      }

      const throttleInfo = extractThrottleInfo(data);
      if (throttleInfo) {
        info(
          `Shopify cost: requested=${throttleInfo.requestedQueryCost}, ` +
            `actual=${throttleInfo.actualQueryCost}, ` +
            `credits=${throttleInfo.currentlyAvailable}/${throttleInfo.maximumAvailable}, ` +
            `restoreRate=${throttleInfo.restoreRate}/s`
        );
        await applyPreemptiveThrottleWait(throttleInfo);
      }

      return data;
    } catch (err) {
      const status = err.response?.status;
      const body = err.response?.data;

      if (status === 429) {
        warn(
          `Received 429 Too Many Requests from Shopify (attempt ${attempt}/${MAX_RETRIES}).`
        );

        let retryAfterMs = backoffMs;
        const retryAfterHeader = err.response.headers?.["retry-after"];
        if (retryAfterHeader) {
          const retrySeconds = parseFloat(retryAfterHeader);
          if (!isNaN(retrySeconds)) {
            retryAfterMs = Math.max(retryAfterMs, retrySeconds * 1000);
          }
        }

        if (attempt > MAX_RETRIES) {
          error(`Max retries reached for Shopify request after 429. Aborting.`);
          throw err;
        }

        warn(`Waiting ${retryAfterMs} ms before retrying...`);
        await sleep(retryAfterMs);
        backoffMs *= 2;
        continue;
      }
      error(
        `HTTP error calling Shopify (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`
      );
      if (body) {
        error(`Response body: ${JSON.stringify(body, null, 2)}`);
      }
      throw err;
    }
  }
  throw new Error("Unexpected state in callShopifyGraphQL retry loop.");
}

const PRODUCT_BY_HANDLE_QUERY = `
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      handle
      title
      variants(first: 250) {
        nodes {
          id
          sku
          title
          inventoryItem {
          id
          }
        }
      }
    }
  }
`;

async function fetchProductByHandle(handle) {
  const data = await callShopifyGraphQL(PRODUCT_BY_HANDLE_QUERY, { handle });

  const product = data?.data?.productByHandle || null;
  if (product) {
    info(`Found existing product for handle "${handle}" (id: ${product.id}).`);
  } else {
    info(`No existing product found for handle "${handle}". Will create.`);
  }

  return product;
}

const INVENTORY_SET_QUANTITIES_MUTATION = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors {
        field
        message
      }
      inventoryAdjustmentGroup {
        createdAt
        reason
      }
    }
  }
`;

async function setInventoryQuantities(input) {
  const data = await callShopifyGraphQL(
    INVENTORY_SET_QUANTITIES_MUTATION,
    { input }
  );

  const payload = data?.data?.inventorySetQuantities;

  if (payload?.userErrors && payload.userErrors.length > 0) {
    error(
      `inventorySetQuantities userErrors: ${JSON.stringify(
        payload.userErrors,
        null,
        2
      )}`
    );
  } else {
    info(
      `inventorySetQuantities success (reason="${input.reason}", name="${input.name}")`
    );
  }

  return payload;
}

module.exports = {
  callShopifyGraphQL,
  fetchProductByHandle,
  setInventoryQuantities,
};
