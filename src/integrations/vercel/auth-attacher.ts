import { createMiddleware } from "@tanstack/react-start";

/** Cookies are sent automatically; ensure fetch credentials for server functions. */
export const attachAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  return next({
    fetchOptions: { credentials: "include" },
  });
});
