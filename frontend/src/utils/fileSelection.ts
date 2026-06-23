type FileCollection = Iterable<File> | ArrayLike<File>;

export function firstImageFile(files: FileCollection): File | null {
  for (const file of toFiles(files)) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}

export function hasDraggedFiles(types: Iterable<string> | ArrayLike<string>): boolean {
  for (const type of toArray(types)) {
    if (type === "Files") return true;
  }
  return false;
}

function toFiles(files: FileCollection): File[] {
  return toArray(files);
}

function toArray<T>(items: Iterable<T> | ArrayLike<T>): T[] {
  if (Symbol.iterator in Object(items)) {
    return Array.from(items as Iterable<T>);
  }

  if (!isArrayLike(items)) return [];

  const result: T[] = [];
  for (let index = 0; index < items.length; index += 1) {
    result.push(items[index]);
  }
  return result;
}

function isArrayLike<T>(items: Iterable<T> | ArrayLike<T>): items is ArrayLike<T> {
  return "length" in Object(items);
}
