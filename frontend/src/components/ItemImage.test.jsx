import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";

import ItemImage from "./ItemImage.jsx";

// Renders the component for real (jsdom) and returns the <img> element, or null
// when it falls back to the placeholder. We assert the actual DOM src, not an API
// shape — the whole point of the driver abstraction is that the frontend renders
// whatever resolved URL the backend hands it, with no knowledge of STORAGE_DRIVER.
function renderImg(image) {
  const { container } = render(<ItemImage image={image} alt="widget" />);
  return container.querySelector("img");
}

const UPDATED_AT = "2026-06-20T10:00:00.000Z";
const V = `?v=${new Date(UPDATED_AT).getTime()}`; // cache-bust the component appends

describe("ItemImage src resolution (ADR-012 driver-agnostic)", () => {
  test("upload-kind, STORAGE_DRIVER=local: renders the backend static URL + cache-bust (no regression)", () => {
    // Backend's LocalDiskDriver.urlFor → relative static route. This is exactly
    // what the component produced before the wiring change.
    const img = renderImg({
      kind: "upload",
      ref: "abc-123.jpg",
      url: "/api/static/items/abc-123.jpg",
      updatedAt: UPDATED_AT,
    });
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe(`/api/static/items/abc-123.jpg${V}`);
  });

  test("upload-kind, STORAGE_DRIVER=s3: renders the R2 public URL the backend resolved", () => {
    // Backend's S3Driver.urlFor → absolute R2 public URL. The component renders it
    // verbatim (plus cache-bust) without knowing a different driver is active.
    const img = renderImg({
      kind: "upload",
      ref: "abc-123.jpg",
      url: "https://img.example.com/abc-123.jpg",
      updatedAt: UPDATED_AT,
    });
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe(`https://img.example.com/abc-123.jpg${V}`);
  });

  test("url-kind (pasted external link) is untouched: src is the ref, no cache-bust", () => {
    const external = "https://cdn.somewhere.com/photo.jpg";
    const img = renderImg({ kind: "url", ref: external, updatedAt: UPDATED_AT });
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe(external);
  });

  test("upload-kind with no resolved url falls back to the placeholder (no broken <img>)", () => {
    const img = renderImg({ kind: "upload", ref: "abc-123.jpg", updatedAt: UPDATED_AT });
    expect(img).toBeNull(); // placeholder div, not an <img>
  });

  test("no image renders the placeholder", () => {
    expect(renderImg(null)).toBeNull();
  });
});
