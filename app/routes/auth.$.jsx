import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { checkAuthRateLimit } from "../utils/rateLimiter";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const rateLimitResponse = checkAuthRateLimit(request, shop);
  if (rateLimitResponse) return rateLimitResponse;

  await authenticate.admin(request);

  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
