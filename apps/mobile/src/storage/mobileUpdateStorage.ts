import AsyncStorage from "@react-native-async-storage/async-storage";
import { mobileUpdatePolicySchema, type MobileUpdatePolicy } from "@persona/shared";

const POLICY_KEY = "mobile-update-policy:v1";
const OPTIONAL_DISMISSAL_KEY = "mobile-update-dismissal:v1";

export async function readCachedMobileUpdatePolicy(): Promise<MobileUpdatePolicy | undefined> {
  const raw = await AsyncStorage.getItem(POLICY_KEY);
  if (!raw) return undefined;
  try {
    const result = mobileUpdatePolicySchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export async function cacheMobileUpdatePolicy(policy: MobileUpdatePolicy): Promise<void> {
  await AsyncStorage.setItem(POLICY_KEY, JSON.stringify(policy));
}

export async function readDismissedOptionalBuild(): Promise<number | undefined> {
  const raw = await AsyncStorage.getItem(OPTIONAL_DISMISSAL_KEY);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export async function dismissOptionalBuild(build: number): Promise<void> {
  await AsyncStorage.setItem(OPTIONAL_DISMISSAL_KEY, String(build));
}
