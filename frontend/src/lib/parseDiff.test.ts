import { describe, expect, it } from "vitest";
import { parseDiff } from "./parseDiff";

const MODIFIED_FILE_DIFF = `diff --git a/main.py b/main.py
index 17c7df1..5b6bd6b 100644
--- a/main.py
+++ b/main.py
@@ -6,3 +6,8 @@ app = FastAPI()
 @app.get("/ping")
 def ping():
     return {"message": "pong"}
+
+
+@app.get("/health")
+def health():
+    return {"status": "ok"}
`;

const NEW_FILE_DIFF = `diff --git a/src/webhooks/stripe.py b/src/webhooks/stripe.py
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/webhooks/stripe.py
@@ -0,0 +1,4 @@
+import hmac
+
+router = APIRouter()
+
`;

const DELETED_FILE_DIFF = `diff --git a/src/webhooks/legacy_handler.py b/src/webhooks/legacy_handler.py
deleted file mode 100644
index abc1234..0000000
--- a/src/webhooks/legacy_handler.py
+++ /dev/null
@@ -1,3 +0,0 @@
-import re
-
-def legacy_dispatch(payload):
`;

const MULTI_FILE_DIFF = `${MODIFIED_FILE_DIFF}diff --git a/tests/test_main.py b/tests/test_main.py
index 0564398..5cf91e4 100644
--- a/tests/test_main.py
+++ b/tests/test_main.py
@@ -8,3 +8,9 @@ def test_ping():
     response = client.get("/ping")
     assert response.status_code == 200
     assert response.json() == {"message": "pong"}
+
+
+def test_health():
+    response = client.get("/health")
+    assert response.status_code == 200
+    assert response.json() == {"status": "ok"}
`;

describe("parseDiff", () => {
  it("returns an empty array for empty/blank input", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("   \n  ")).toEqual([]);
  });

  it("parses a modified file with correct kind, counts, and line content", () => {
    const [file] = parseDiff(MODIFIED_FILE_DIFF);
    expect(file?.filename).toBe("main.py");
    expect(file?.kind).toBe("modified");
    expect(file?.added).toBe(5);
    expect(file?.removed).toBe(0);
    expect(file?.lines.some((line) => line.type === "add" && line.content === '@app.get("/health")')).toBe(
      true,
    );
    expect(file?.lines.some((line) => line.type === "context" && line.content === '@app.get("/ping")')).toBe(
      true,
    );
  });

  it("detects a new file", () => {
    const [file] = parseDiff(NEW_FILE_DIFF);
    expect(file?.kind).toBe("new");
    expect(file?.added).toBe(4);
    expect(file?.removed).toBe(0);
  });

  it("detects a deleted file", () => {
    const [file] = parseDiff(DELETED_FILE_DIFF);
    expect(file?.kind).toBe("deleted");
    expect(file?.added).toBe(0);
    expect(file?.removed).toBe(3);
  });

  it("splits a multi-file diff into separate entries", () => {
    const files = parseDiff(MULTI_FILE_DIFF);
    expect(files).toHaveLength(2);
    expect(files[0]?.filename).toBe("main.py");
    expect(files[1]?.filename).toBe("tests/test_main.py");
  });

  it("assigns correct line numbers for added and context lines", () => {
    const [file] = parseDiff(MODIFIED_FILE_DIFF);
    const firstContext = file?.lines.find((line) => line.type === "context");
    expect(firstContext?.lineNumber).toBe(6);
    const firstAdd = file?.lines.find((line) => line.type === "add");
    expect(firstAdd?.lineNumber).toBe(9);
  });

  it("inserts a collapsed separator between multiple hunks in the same file", () => {
    const twoHunkDiff = `diff --git a/f.py b/f.py
index 111..222 100644
--- a/f.py
+++ b/f.py
@@ -1,2 +1,2 @@
-a
+b
@@ -10,2 +10,2 @@
-c
+d
`;
    const [file] = parseDiff(twoHunkDiff);
    expect(file?.lines.some((line) => line.type === "collapsed")).toBe(true);
  });
});
