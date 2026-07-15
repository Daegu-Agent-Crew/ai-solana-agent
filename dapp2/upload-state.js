export function createUploadKey(file, metadata) {
  if (!file) return '';
  return JSON.stringify([
    file.name || '',
    Number(file.size || 0),
    Number(file.lastModified || 0),
    file.type || '',
    String(metadata?.name || '').trim(),
    String(metadata?.symbol || '').trim().toUpperCase(),
    String(metadata?.description || '').trim(),
  ]);
}
