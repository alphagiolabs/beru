export function fileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}
