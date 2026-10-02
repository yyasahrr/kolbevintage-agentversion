import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { GET, POST } from "@/app/api/v1/supplier/applications/route";

describe("supplier application routes", () => {
  beforeEach(() => {
    resetEnvironmentForTests();
  });

  it("requires authentication to list applications", async () => {
    const response = await GET(new Request("http://localhost/api/v1/supplier/applications"));
    expect(response.status).toBe(401);
  });

  it("requires authentication before accepting an application", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/supplier/applications", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
