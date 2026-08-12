import type { BrickApi } from "../preload";

declare global {
  interface Window {
    brick: BrickApi;
  }
}

export {};
