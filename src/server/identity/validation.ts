import { z } from "zod";
import { maximumPasswordLength, minimumPasswordLength } from "@/server/identity/credentials";

export const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(minimumPasswordLength).max(maximumPasswordLength),
});

export type CredentialsInput = z.infer<typeof credentialsSchema>;
