import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

const ANDROID_EXPORT_DIRECTORY_URI_KEY = 'pos:android:exportDirectoryUri:v1';

function sanitizeFilenameForAndroid(filename: string): string {
  const trimmed = String(filename || '').trim();
  const replaced = trimmed
    .replace(/[\\/]/g, '_')
    .replace(/[:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');
  return replaced.length > 0 ? replaced : `export_${Date.now()}`;
}

async function getOrPromptAndroidExportDirectory() {
  // On Android, we want a stable, user-approved folder (ideally Downloads).
  // We store the directory URI so future exports don't prompt again.
  const storedUri = await AsyncStorage.getItem(ANDROID_EXPORT_DIRECTORY_URI_KEY);
  if (storedUri) {
    try {
      const dir = new Directory(storedUri);
      // Accessing list() is a reliable way to validate permission.
      // If permission is lost, it will throw.
      dir.list();
      return dir;
    } catch {
      await AsyncStorage.removeItem(ANDROID_EXPORT_DIRECTORY_URI_KEY);
    }
  }

  // This opens the system directory picker.
  // The user should choose "Descargas / Download".
  const pickedDir = await Directory.pickDirectoryAsync();
  await AsyncStorage.setItem(ANDROID_EXPORT_DIRECTORY_URI_KEY, pickedDir.uri);
  return pickedDir;
}

async function writeTextToExportLocation(params: {
  filename: string;
  content: string;
  mimeType: string;
}): Promise<void> {
  const safeName = Platform.OS === 'android' ? sanitizeFilenameForAndroid(params.filename) : params.filename;

  if (Platform.OS === 'android') {
    const dir = await getOrPromptAndroidExportDirectory();
    const file = dir.createFile(safeName, params.mimeType);
    file.write(params.content);
    return;
  }

  // iOS fallback: keep it in app documents (safe, persistent).
  // (Sharing/export outside of the sandbox can still be done by the user via Files app.)
  const file = new File(Paths.document, safeName);
  file.create({ overwrite: true, intermediates: true });
  file.write(params.content);
}

async function readPickedFileAsText(file: File): Promise<string> {
  // File.text() works for both file:// and content:// uris.
  const text = await file.text();
  // Remove UTF-8 BOM if present
  return (text ?? '').replace(/^\uFEFF/, '');
}

export async function exportTextFile(params: {
  filename: string;
  content: string;
  mimeType?: string;
}): Promise<void> {
  const mimeType = params.mimeType ?? 'text/plain';

  if (Platform.OS === 'web') {
    const BlobRef = (globalThis as any).Blob;
    const URLRef = (globalThis as any).URL;
    const documentRef = (globalThis as any).document;
    const blob = new BlobRef([params.content], { type: mimeType });
    const url = URLRef.createObjectURL(blob);
    const a = documentRef.createElement('a');
    a.href = url;
    a.download = params.filename;
    documentRef.body.appendChild(a);
    a.click();
    try {
      if (a && a.parentNode) (a.parentNode as any).removeChild(a);
    } catch {}
    URLRef.revokeObjectURL(url);
    return;
  }

  await writeTextToExportLocation({
    filename: params.filename,
    content: params.content,
    mimeType,
  });
}

export async function exportJSONFile(filename: string, jsonData: unknown): Promise<void> {
  const content = JSON.stringify(jsonData, null, 2);

  if (Platform.OS === 'web') {
    const BlobRef = (globalThis as any).Blob;
    const URLRef = (globalThis as any).URL;
    const documentRef = (globalThis as any).document;
    const blob = new BlobRef([content], { type: 'application/json' });
    const url = URLRef.createObjectURL(blob);
    const a = documentRef.createElement('a');
    a.href = url;
    a.download = filename;
    documentRef.body.appendChild(a);
    a.click();
    try {
      if (a && a.parentNode) (a.parentNode as any).removeChild(a);
    } catch {}
    URLRef.revokeObjectURL(url);
    return;
  }

  await writeTextToExportLocation({
    filename,
    content,
    mimeType: 'application/json',
  });
}

export async function exportCSVFile(filename: string, csvContent: string): Promise<void> {
  if (Platform.OS === 'web') {
    const BlobRef = (globalThis as any).Blob;
    const URLRef = (globalThis as any).URL;
    const documentRef = (globalThis as any).document;
    const blob = new BlobRef([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URLRef.createObjectURL(blob);
    const a = documentRef.createElement('a');
    a.href = url;
    a.download = filename;
    documentRef.body.appendChild(a);
    a.click();
    try {
      if (a && a.parentNode) (a.parentNode as any).removeChild(a);
    } catch {}
    URLRef.revokeObjectURL(url);
    return;
  }

  await writeTextToExportLocation({
    filename,
    content: csvContent,
    mimeType: 'text/csv',
  });
}

export async function importJSONFile<T = unknown>(): Promise<T | null> {
  if (Platform.OS === 'web') {
    return new Promise<T | null>((resolve) => {
      const documentRef = (globalThis as any).document;
      const FileReaderRef = (globalThis as any).FileReader;
      const input = documentRef.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReaderRef();
        reader.onload = () => {
          try {
            const text = reader.result as string;
            const obj = JSON.parse(text);
            resolve(obj as T);
          } catch (e) {
            console.error('Failed to parse JSON file', e);
            resolve(null);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
  }

  try {
    // Prefer the built-in picker from expo-file-system (more reliable in SDK 54).
    const picked = await File.pickFileAsync(undefined, 'application/json');
    const text = await readPickedFileAsText(picked);
    return JSON.parse(text) as T;
  } catch (err) {
    // Fallback to expo-document-picker if needed.
    try {
      const DocumentPicker = await import('expo-document-picker');
      const res: any = await (DocumentPicker as any).getDocumentAsync({
        type: ['application/json', 'application/*', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      } as any);

      const canceled = (res && typeof res === 'object' && 'canceled' in res) ? res.canceled === true : res?.type === 'cancel';
      const uri = (res && typeof res === 'object' && 'assets' in res) ? res.assets?.[0]?.uri : res?.uri;
      if (canceled || !uri) return null;

      const file = new File(uri);
      const text = await readPickedFileAsText(file);
      return JSON.parse(text) as T;
    } catch (fallbackErr) {
      console.error('importJSONFile error', fallbackErr);
      throw fallbackErr;
    }
  }
}

export async function importCSVFile(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return new Promise<string | null>((resolve) => {
      const documentRef = (globalThis as any).document;
      const FileReaderRef = (globalThis as any).FileReader;
      const input = documentRef.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReaderRef();
        reader.onload = () => {
          try {
            const text = reader.result as string;
            resolve(text);
          } catch (e) {
            console.error('Failed to read CSV file', e);
            resolve(null);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
  }

  try {
    const picked = await File.pickFileAsync();
    return await readPickedFileAsText(picked);
  } catch {
    return null;
  }
}

export type PickedBackup =
  | { kind: 'json'; data: any; name?: string }
  | { kind: 'sqlite'; uri: string; name?: string };

export interface BackupPickOptions {
  mode?: 'auto-store' | 'auto-general' | 'picker';
  sanitizedStoreName?: string;
}

export async function pickBackupFile(_options?: BackupPickOptions): Promise<PickedBackup | null> {
  if (Platform.OS === 'web') {
    return new Promise<PickedBackup | null>((resolve) => {
      const documentRef = (globalThis as any).document;
      const FileReaderRef = (globalThis as any).FileReader;
      const input = documentRef.createElement('input');
      input.type = 'file';
      input.accept = '.json,.db,.sqlite,application/json,application/octet-stream';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const name = file.name || '';
        const ext = name.split('.').pop()?.toLowerCase();
        if (ext === 'json') {
          const reader = new FileReaderRef();
          reader.onload = () => {
            try {
              const text = reader.result as string;
              const obj = JSON.parse(text);
              resolve({ kind: 'json', data: obj, name });
            } catch (e) {
              console.error('Failed to parse JSON file', e);
              resolve(null);
            }
          };
          reader.readAsText(file);
        } else {
          console.warn('SQLite DB import is not supported on web. Use a .json backup instead.');
          resolve(null);
        }
      };
      input.click();
    });
  }

  try {
    const picked = await File.pickFileAsync();

    const name = picked.name || undefined;
    const extFromName = (name || '').split('.').pop()?.toLowerCase();
    const extFromUri = (picked.uri || '').split('.').pop()?.toLowerCase();
    const ext = (extFromName || extFromUri || '').toLowerCase();

    if (ext === 'db' || ext === 'sqlite') {
      return { kind: 'sqlite', uri: picked.uri, name };
    }

    const text = await readPickedFileAsText(picked);
    const obj = JSON.parse(text);
    return { kind: 'json', data: obj, name };
  } catch (err) {
    console.error('pickBackupFile error:', err);
    return null;
  }
}