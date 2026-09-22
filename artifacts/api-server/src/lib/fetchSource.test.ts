import { test } from "node:test";
import assert from "node:assert/strict";
import { imageUrlOf } from "./fetchSource";

const page = "https://example.com/recipes/lemon-loaf";

test("schema.org image: a string, an array, an ImageObject, and the first usable wins", () => {
  assert.equal(imageUrlOf("https://cdn.example.com/loaf.jpg"), "https://cdn.example.com/loaf.jpg");
  assert.equal(imageUrlOf(["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]), "https://cdn.example.com/a.jpg");
  assert.equal(imageUrlOf({ "@type": "ImageObject", url: "https://cdn.example.com/obj.jpg" }), "https://cdn.example.com/obj.jpg");
  assert.equal(imageUrlOf({ "@type": "ImageObject", contentUrl: "https://cdn.example.com/c.jpg" }), "https://cdn.example.com/c.jpg");
  assert.equal(imageUrlOf([{ "@type": "ImageObject" }, "https://cdn.example.com/second.jpg"]), "https://cdn.example.com/second.jpg", "an object with no url is skipped, not fatal");
});

test("relative URLs resolve against the page; everything that is not a web address is null", () => {
  assert.equal(imageUrlOf("/images/loaf.jpg", page), "https://example.com/images/loaf.jpg");
  assert.equal(imageUrlOf("//cdn.example.com/x.jpg", page), "https://cdn.example.com/x.jpg");
  assert.equal(imageUrlOf("data:image/png;base64,AAAA", page), null, "a data URI is bytes, not a pointer the server fetches");
  assert.equal(imageUrlOf("javascript:alert(1)", page), null);
  assert.equal(imageUrlOf("", page), null);
  assert.equal(imageUrlOf(undefined, page), null);
  assert.equal(imageUrlOf(42, page), null);
  assert.equal(imageUrlOf("x".repeat(3000), page), null, "an absurd length is refused");
});
