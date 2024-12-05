import { handleRequest } from "@growthbook/edge-cloudflare";

export default {
  fetch: async function (request, env, ctx) {
    return await handleRequest(request, env);
  },
};
