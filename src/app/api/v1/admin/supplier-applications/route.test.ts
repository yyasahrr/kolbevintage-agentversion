import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { GET } from "@/app/api/v1/admin/supplier-applications/route";

describe("admin supplier review routes", () => {
  beforeEach(() => {
    resetEnvironmentForTests();
  });

  it("requires authentication before checking review permission", async () => {
    const response = await GET(new Request("http://localhost/api/v1/admin/supplier-applications"));
    expect(response.status).toBe(401);
  });
});
