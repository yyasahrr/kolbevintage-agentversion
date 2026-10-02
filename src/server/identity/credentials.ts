export const minimumPasswordLength = 12;
export const maximumPasswordLength = 128;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAcceptablePassword(password: string): boolean {
  return (
    password.length >= minimumPasswordLength && password.length <= maximumPasswordLength
  );
}
