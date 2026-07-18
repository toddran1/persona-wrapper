export function authCookieAttributes(nodeEnv: string): {
  sameSite: "lax" | "none";
  secure: boolean;
} {
  return nodeEnv === "production"
    ? { sameSite: "none", secure: true }
    : { sameSite: "lax", secure: false };
}
