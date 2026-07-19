import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const DOWNLOAD_DIRECTORY_KEY = "for-the-baddiez-download-directory";

export type DeviceSaveResult = "saved" | "cancelled" | "unavailable";

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "download";
}

function storageAccessFileName(fileName: string): string {
  // Preserve the suffix (especially `.zip`) because Android's document
  // providers do not consistently infer one from the MIME type.
  return safeFileName(fileName);
}

async function selectedDirectoryUri(): Promise<string | undefined> {
  const savedDirectory = await SecureStore.getItemAsync(DOWNLOAD_DIRECTORY_KEY);
  if (savedDirectory) return savedDirectory;

  const initialDirectory = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot("Download");
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(initialDirectory);
  if (!permission.granted || !permission.directoryUri) return undefined;
  await SecureStore.setItemAsync(DOWNLOAD_DIRECTORY_KEY, permission.directoryUri);
  return permission.directoryUri;
}

/**
 * Android scoped storage requires the user to choose a public folder. The
 * selected directory is persisted by the operating system and remembered here
 * for future saves. `copyAsync` transfers the cached file natively, avoiding a
 * JavaScript/base64 copy for large archives.
 */
export async function saveFileToDevice(sourceUri: string, fileName: string, mimeType: string): Promise<DeviceSaveResult> {
  if (Platform.OS !== "android") return "unavailable";
  const directoryUri = await selectedDirectoryUri();
  if (!directoryUri) return "cancelled";

  try {
    const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(
      directoryUri,
      storageAccessFileName(fileName),
      mimeType
    );
    await FileSystem.copyAsync({ from: sourceUri, to: destinationUri });
    return "saved";
  } catch (error) {
    // A user can revoke the persisted folder permission outside the app. Make
    // the next attempt open the picker again rather than repeatedly failing.
    if (/permission|security|not found|does not exist|invalid uri/i.test(error instanceof Error ? error.message : "")) {
      await SecureStore.deleteItemAsync(DOWNLOAD_DIRECTORY_KEY);
    }
    throw error;
  }
}
