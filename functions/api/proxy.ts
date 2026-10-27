import { handleProxy } from "../_shared/proxy";

export const onRequestGet: PagesFunction = (ctx) => handleProxy(ctx.request, caches.default);
