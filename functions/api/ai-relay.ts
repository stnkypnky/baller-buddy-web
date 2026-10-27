import { handleRelay } from "../_shared/relay";

export const onRequest: PagesFunction = (ctx) => handleRelay(ctx.request);
