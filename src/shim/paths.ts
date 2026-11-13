/**
 * Turn a link or image target written in a Markdown file into a path inside the open project.
 *
 * OpenChamber reads project files by a path relative to the project folder, with forward
 * slashes and no `..` segment. Anything that points outside the project has no such path.
 */

const toSlashes = (value: string): string => value.replace(/\\/g, '/');

const isAbsolute = (value: string): boolean => value.startsWith('/') || /^[a-zA-Z]:\//.test(value);

/** Whether the target is a web address, a mail link or any other URL with a scheme. */
export function hasScheme(target: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) && !/^[a-zA-Z]:[\\/]/.test(target);
}

/** Drop the `?query` and `#fragment` of a target, and decode `%20` and the like. */
export function cleanTarget(target: string): string {
  const cut = target.search(/[?#]/);
  const path = cut < 0 ? target : target.slice(0, cut);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * The folder of the open document, relative to the project.
 *
 * @param documentPath - the path OpenChamber shows for the file, absolute or project-relative
 * @param projectDirectory - the open project's folder, or null when no project is open
 * @returns the folder ('' for the project root), or null when the file is outside the project
 */
export function documentFolder(documentPath: string, projectDirectory: string | null): string | null {
  const path = toSlashes(documentPath);
  let relative = path;
  if (isAbsolute(path)) {
    if (!projectDirectory) return null;
    const root = toSlashes(projectDirectory).replace(/\/+$/, '');
    const windows = /^[a-zA-Z]:\//.test(root);
    const head = path.slice(0, root.length);
    const sameRoot = windows ? head.toLowerCase() === root.toLowerCase() : head === root;
    if (!sameRoot || path[root.length] !== '/') return null;
    relative = path.slice(root.length + 1);
  }
  relative = relative.replace(/^\.\//, '');
  const cut = relative.lastIndexOf('/');
  return cut < 0 ? '' : relative.slice(0, cut);
}

/**
 * Resolve a target against the document's folder.
 *
 * @param folder - the document's folder inside the project, from {@link documentFolder}
 * @param target - the link or image target as written; a leading `/` means the project root
 * @returns a project-relative path, or null for a URL or a path that leaves the project
 */
export function resolveProjectPath(folder: string | null, target: string): string | null {
  if (folder === null || target.trim() === '' || hasScheme(target)) return null;
  const cleaned = toSlashes(cleanTarget(target.trim()));
  if (cleaned === '' || /^[a-zA-Z]:\//.test(cleaned)) return null;

  const fromRoot = cleaned.startsWith('/');
  const segments = fromRoot || folder === '' ? [] : folder.split('/');
  for (const segment of cleaned.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join('/');
}
