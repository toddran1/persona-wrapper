import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: () => {}
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  writable: true,
  value: () => {}
});

class MockDataTransferItemList {
  private readonly store: File[] = [];

  add(file: File): void {
    this.store.push(file);
  }

  get files(): File[] {
    return this.store;
  }
}

class MockDataTransfer {
  readonly items = new MockDataTransferItemList();

  get files(): File[] {
    return this.items.files;
  }
}

Object.defineProperty(window, "DataTransfer", {
  configurable: true,
  writable: true,
  value: MockDataTransfer
});

afterEach(() => {
  cleanup();
});
