import type { InkosProvider } from "./types.js";

/**
 * newapi 是 OneAPI / new-api 中转网关的锚点 provider。
 * 跟 custom 类似：baseUrl 由用户在 Studio 填（指向自己部署的 new-api 网关），
 * models 默认为空，实际可走 live /models probe（跟 custom 共用逻辑）。
 */
export const NEWAPI: InkosProvider = {
  id: "newapi",
  label: "New API (中转网关)",
  api: "openai-completions",
  baseUrl: "",
  models: [],
};
