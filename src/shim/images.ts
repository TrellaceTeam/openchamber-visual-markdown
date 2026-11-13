/**
 * Find something the page can show for an image written with a local path.
 *
 * The page runs in a sandbox. It cannot load a file from the project by URL, and OpenChamber
 * hands file content over as text only. So an SVG, which is text, can be shown: it is read
 * and given to the editor as a blob URL. A PNG or JPEG cannot, and the editor shows its
 * "could not load" state for it.
 */
import { resolveProjectPath } from './paths';

export interface ImageResolverOptions {
  /** Read a text file by project-relative path. */
  readonly readFile: (path: string) => Promise<{ content: string }>;
  /** The open document's folder inside the project, or null when it has none. */
  readonly folder: () => string | null;
}

export interface ImageResolver {
  /** A URL the page can load for the image, or '' when it cannot be shown. */
  resolve: (target: string) => Promise<string>;
  /** Forget what was read for the previous file. */
  reset: () => void;
}

const isSvgPath = (path: string): boolean => /\.svg$/i.test(path);

const looksLikeSvg = (content: string): boolean => /<svg[\s>]/i.test(content.slice(0, 4096));

export function createImageResolver(options: ImageResolverOptions): ImageResolver {
  const cache = new Map<string, Promise<string>>();

  const load = async (path: string): Promise<string> => {
    try {
      const { content } = await options.readFile(path);
      if (!looksLikeSvg(content)) return '';
      return URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }));
    } catch {
      return '';
    }
  };

  return {
    resolve: (target) => {
      const path = resolveProjectPath(options.folder(), target);
      if (path === null || !isSvgPath(path)) return Promise.resolve('');
      let pending = cache.get(path);
      if (!pending) {
        pending = load(path);
        cache.set(path, pending);
      }
      return pending;
    },
    reset: () => {
      for (const pending of cache.values()) {
        void pending.then((url) => {
          if (url) URL.revokeObjectURL(url);
        });
      }
      cache.clear();
    },
  };
}
